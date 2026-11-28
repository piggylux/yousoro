<script lang="ts" module>
  /** A page of what a header dropdown lists */
  export type FeedPage<T> = { items: T[]; hasNextPage: boolean };

  /** How a row reads: who or what first, then what happened */
  export type FeedRow = {
    title: string;
    summary: string;
    /** A line under it, like how a submission went or how many liked it */
    detail?: string | null;
    /** Marks it as new since last time */
    isNew?: boolean;
  };
</script>

<script lang="ts" generics="T extends { id: number; createdAt: number; href: string | null }">
  import { tick, type Snippet } from 'svelte';

  import { clock } from '#lib/clock.js';
  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import Popover, { type PopoverTriggerProps } from '#lib/components/Popover.svelte';
  import SignInButton from '#lib/components/SignInButton.svelte';
  import { formatAirDate, formatTimeAgo } from '#lib/countdown.js';
  import { groupByDay } from '#lib/notifications.js';
  import { clearReadRetries, retryAfterSeconds } from '#lib/read-retry.js';

  type Props = {
    /** The header's button, styled by the header, with the dropdown's props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
    heading: string;
    /** The same list on AniList */
    anilistUrl: string;
    /** What it lists, as "notifications": "Loading notifications…", "Your notifications couldn't…" */
    noun: string;
    /** Said when there's nothing to list */
    empty: string;
    /** Spaces out the automatic retries while AniList is busy */
    retryKey: string;
    /** Asks the server for a page, from 1 */
    fetchPage: (page: number) => Promise<Response>;
    /** Reads the server's answer for a page; the first page is the newest */
    readPage: (body: unknown, page: number) => FeedPage<T>;
    /**
     * Asked on opening again while the newest page is still shown, given when it loaded: whether to
     * keep showing it rather than asking AniList again
     */
    reuse: (loadedAt: number) => boolean;
    /** How a row reads, given its place in the whole list */
    describe: (item: T, index: number) => FeedRow;
    /** The picture at the start of a row: a cover, an avatar or an icon, hidden from screen readers */
    thumbnail: Snippet<[T]>;
    /** How the loaded list is announced, as "12 notifications" */
    countLabel: (count: number) => string;
    /** Told as the dropdown starts to open or close */
    ontoggle?: (open: boolean) => void;
  };

  let {
    trigger,
    heading,
    anilistUrl,
    noun,
    empty,
    retryKey,
    fetchPage,
    readPage,
    reuse,
    describe,
    thumbnail,
    countLabel,
    ontoggle,
  }: Props = $props();

  type Problem = { message: string; retryAt?: number; signedOut?: boolean };
  /** The list, as far as it's loaded */
  type Feed = {
    items: T[];
    pages: number;
    hasNextPage: boolean;
    /** The first page is on its way */
    loading: boolean;
    loadingMore: boolean;
    /** Why the first page didn't load */
    problem?: Problem;
    /** Why the next page didn't load; the ones already shown stay */
    moreProblem?: Problem;
  };

  let popover = $state<Popover>();
  let list = $state<HTMLElement>();
  const headingId = $props.id();

  /**
   * Whether the dropdown is open. The list only shows then, so nothing in it, like an automatic retry
   * or the times ticking on, runs while it's closed
   */
  let open = $state(false);
  let feed = $state<Feed | null>(null);
  // When AniList last sent the newest ones
  let loadedAt = 0;
  // Bumped on starting over, so an answer for the round before is dropped
  let round = 0;

  function onopen() {
    if (feed?.loading) return;
    if (feed && !feed.problem && reuse(loadedAt)) return;
    round++;
    feed = null;
    void load(1);
  }

  async function problemOf(response: Response): Promise<Problem> {
    if (response.status === 429) {
      return {
        // The automatic retry below it says that AniList is busy, and when it tries again
        message: `Your ${noun} couldn't be loaded yet.`,
        retryAt: Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000,
      };
    }
    if (response.status === 401) {
      return {
        message: `Your AniList sign-in expired. Sign in again to see your ${noun}.`,
        signedOut: true,
      };
    }
    return { message: `Your ${noun} couldn't be loaded. Please try again.` };
  }

  async function load(pageNumber: number) {
    const asked = round;
    // Trying the first page again keeps its message and button in place until the answer comes
    feed =
      pageNumber > 1
        ? { ...feed!, loadingMore: true, moreProblem: undefined }
        : feed?.problem
          ? { ...feed, loading: true }
          : { items: [], pages: 0, hasNextPage: false, loading: true, loadingMore: false };
    let problem: Problem | null = null;
    let result: FeedPage<T> | null = null;
    try {
      const response = await fetchPage(pageNumber);
      if (response.ok) result = readPage(await response.json(), pageNumber);
      else problem = await problemOf(response);
    } catch {
      problem = {
        message: navigator.onLine
          ? `Your ${noun} couldn't be loaded. Please try again.`
          : "You're offline. Connect to the internet and try again.",
      };
    }
    if (asked !== round || !feed) return;
    if (!result) {
      if (pageNumber === 1) feed = { ...feed, loading: false, problem: problem! };
      else feed = { ...feed, loadingMore: false, moreProblem: problem! };
      return;
    }
    // AniList answered, so a later busy spell gets its automatic retries again
    clearReadRetries(retryKey);
    if (pageNumber === 1) {
      loadedAt = Date.now();
      if (list) list.scrollTop = 0;
    }
    // One that arrived since the last page pushes the rest down by one
    const known = new Set(feed.items.map((item) => item.id));
    const added = result.items.filter(({ id }) => !known.has(id));
    feed = {
      items: [...feed.items, ...added],
      pages: pageNumber,
      hasNextPage: result.hasNextPage,
      loading: false,
      loadingMore: false,
    };
    // The button that had focus, "Try again" or the last "Load more", went with what it loaded: focus
    // carries on from the first new row, or the list
    await tick();
    if (!open || !list || (document.activeElement && document.activeElement !== document.body)) {
      return;
    }
    const first = pageNumber > 1 && added[0] && list.querySelector(`[data-id="${added[0].id}"]`);
    (first instanceof HTMLElement ? first : list).focus();
  }

  // Each row's place in the whole list, for `describe`
  const places = $derived(new Map(feed?.items.map((item, index) => [item.id, index])));

  const announcement = $derived.by(() => {
    if (!feed || feed.loading) return `Loading ${noun}…`;
    if (feed.problem) return '';
    if (feed.loadingMore) return `Loading more ${noun}…`;
    return feed.items.length ? countLabel(feed.items.length) : empty;
  });
</script>

<Popover
  bind:this={popover}
  {trigger}
  align="end"
  width="28rem"
  wide
  ontoggle={(opening) => {
    open = opening;
    ontoggle?.(opening);
    if (opening) onopen();
  }}
>
  <section class="panel" aria-labelledby={headingId}>
    <header>
      <div class="heading-copy">
        <h2 id={headingId}>{heading}</h2>
        <p class="description">
          <a href={anilistUrl} target="_blank" rel="noopener noreferrer"
            >Open on AniList ↗<span class="tw:sr-only"> (opens in a new tab)</span></a
          >
        </p>
      </div>
      <CloseButton label={`Close ${heading.toLowerCase()}`} onclick={() => popover?.close()} />
    </header>

    {#if open}
      <div class="list" bind:this={list} tabindex="-1" aria-busy={!feed || feed.loading}>
        {#if !feed || (feed.loading && !feed.problem)}
          <p class="message">
            <span class="tw:loading tw:loading-spinner tw:loading-sm" aria-hidden="true"></span>
            Loading {noun}…
          </p>
        {:else if feed.problem}
          <div class="message">
            <p role="alert">{feed.problem.message}</p>
            {#if feed.problem.signedOut}
              <SignInButton compact />
            {:else}
              {#if feed.problem.retryAt}
                <AutoReadRetry
                  {retryKey}
                  retryAt={feed.problem.retryAt}
                  onretry={() => {
                    if (feed && !feed.loading) void load(1);
                  }}
                />
              {/if}
              <button
                class="tw:btn tw:btn-sm"
                type="button"
                aria-disabled={feed.loading}
                onclick={() => {
                  if (feed && !feed.loading) void load(1);
                }}
              >
                {#if feed.loading}<span
                    class="tw:loading tw:loading-spinner tw:loading-xs"
                    aria-hidden="true"
                  ></span>{/if}
                Try again
              </button>
            {/if}
          </div>
        {:else if feed.items.length === 0}
          <p class="message">{empty}</p>
        {:else}
          {#each groupByDay(feed.items, clock.now) as group (group.day)}
            <h3 class="day">{group.day}</h3>
            <ul>
              {#each group.notifications as item (item.id)}
                {@const text = describe(item, places.get(item.id) ?? 0)}
                {@const external = item.href?.startsWith('https://') ?? false}
                <li>
                  <svelte:element
                    this={item.href ? 'a' : 'div'}
                    class="row"
                    data-id={item.id}
                    href={item.href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                  >
                    <span class="thumbnail" aria-hidden="true">{@render thumbnail(item)}</span>
                    <!-- Who or what first, then what happened and when; the commas are for screen readers -->
                    <span class="copy">
                      <span class="title" title={text.title}>{text.title}</span><span
                        class="tw:sr-only">,</span
                      >
                      <span class="meta">
                        <span>{text.summary}</span>
                        <span aria-hidden="true">·</span>
                        <time
                          datetime={new Date(item.createdAt).toISOString()}
                          title={formatAirDate(item.createdAt)}
                          >{formatTimeAgo(item.createdAt, clock.now)}</time
                        >{#if text.isNew}<span class="tw:sr-only">,</span>
                          <span class="new-label">New</span>{/if}
                      </span>
                      {#if text.detail}<span class="tw:sr-only">,</span>
                        <span class="detail">{text.detail}</span>{/if}
                    </span>
                    {#if item.href}
                      <span class="row-arrow" aria-hidden="true">{external ? '↗' : '→'}</span>
                      {#if external}<span class="tw:sr-only"> (opens in a new tab)</span>{/if}
                    {/if}
                  </svelte:element>
                </li>
              {/each}
            </ul>
          {/each}
          {#if feed.hasNextPage || feed.moreProblem}
            <!-- The button comes first, so a failure said below it doesn't move it from under the pointer -->
            <div class="more">
              <button
                type="button"
                class="tw:btn tw:btn-sm"
                aria-disabled={feed.loadingMore}
                onclick={() => {
                  if (feed && !feed.loadingMore) void load(feed.pages + 1);
                }}
              >
                {#if feed.loadingMore}<span
                    class="tw:loading tw:loading-spinner tw:loading-xs"
                    aria-hidden="true"
                  ></span>{/if}
                {feed.moreProblem ? 'Try again' : 'Load more'}
              </button>
              {#if feed.moreProblem}<p role="alert">{feed.moreProblem.message}</p>{/if}
            </div>
          {/if}
        {/if}
      </div>
      <p class="tw:sr-only" role="status">{announcement}</p>
    {/if}
  </section>
</Popover>

<style>
  /*
   * A steady height, so the panel doesn't shrink and grow under the pointer as the list loads or
   * fails. It stays clear of the bottom of the screen, which closes it when tapped
   */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: min(calc(100dvh - 96px), 34rem);
    padding: var(--dialog-padding);
    color: var(--color-base-content);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex: none;
    /* The close button's own inset, so its icon lines up with the panel's edge */
    margin: -8px -8px 0 0;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
    padding-top: 8px;
  }
  h2 {
    color: var(--text-heading);
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: normal;
  }
  .description {
    margin-top: 2px;
    color: var(--text-accent);
    font-size: 0.75rem;
  }
  .description a {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .description a:focus-visible,
  .row:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  .list {
    /* Holds the hidden "opens in a new tab" texts, which would otherwise stretch the panel */
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 0 calc(-1 * var(--dialog-padding) / 2);
    padding: 0 calc(var(--dialog-padding) / 2) 4px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .message {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 24px 0;
    color: var(--text-accent);
    font-size: 0.8rem;
    text-align: center;
  }
  p.message {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }
  /* Stays at the top of the list while its day's rows scroll under it */
  .day {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 10px 8px 6px;
    background: var(--surface);
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: normal;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    border-radius: var(--radius-control);
    color: inherit;
    text-decoration: none;
    transition: background 150ms ease;
  }
  a.row:hover {
    background: var(--you-blue-pale);
  }
  .thumbnail {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
  }
  .thumbnail :global(.poster) {
    width: 40px;
  }
  .copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  /* Two lines at most, as most are titles; the whole title shows on hover */
  .title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 650;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 6px;
    color: var(--text-accent);
    font-size: 0.75rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  /* Said in words, so it doesn't rely on colour */
  /* Neutral, as blue is for actions and selection; the word says what it means */
  .new-label {
    display: inline-block;
    padding: 0 6px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface-muted);
    color: var(--text-heading);
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.6;
  }
  .detail {
    color: var(--text-accent);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  .row-arrow {
    flex: none;
    align-self: center;
    color: var(--text-accent);
    font-size: 0.9rem;
    opacity: 0.4;
  }
  .more {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 12px 0 4px;
    color: var(--text-accent);
    font-size: 0.8rem;
    text-align: center;
  }
  .message button[aria-disabled='true'],
  .more button[aria-disabled='true'] {
    cursor: progress;
  }
  @media (pointer: coarse) {
    .message :global(.tw\:btn),
    .more button {
      min-height: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .row {
      transition: none;
    }
  }
</style>

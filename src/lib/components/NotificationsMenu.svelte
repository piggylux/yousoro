<script lang="ts">
  import { page } from '$app/state';
  import { tick, type Snippet } from 'svelte';

  import { clock } from '#lib/clock.js';
  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import Popover, { type PopoverTriggerProps } from '#lib/components/Popover.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import SignInButton from '#lib/components/SignInButton.svelte';
  import { formatAirDate, formatTimeAgo } from '#lib/countdown.js';
  import { markAllRead, notificationCount } from '#lib/notification-count.svelte.js';
  import {
    describeNotification,
    groupByDay,
    notificationDetail,
    reusesNotifications,
    unreadBeforeRead,
  } from '#lib/notifications.js';
  import { clearReadRetries, retryAfterSeconds } from '#lib/read-retry.js';
  import type { AppNotification, NotificationsPage } from '#lib/types/notification.js';

  let {
    trigger,
  }: {
    /** The bell, styled by the header, with the dropdown's props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
  } = $props();

  type Problem = { message: string; retryAt?: number; signedOut?: boolean };
  /** The notifications, as far as they've loaded */
  type Feed = {
    items: AppNotification[];
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

  const EMPTY = 'No notifications yet.';
  const RETRY_KEY = 'notifications';

  let popover = $state<Popover>();
  let list = $state<HTMLElement>();
  const heading = $props.id();

  /**
   * Whether the dropdown is open. The list only shows then, so nothing in it, like an automatic retry
   * or the times ticking on, runs while it's closed
   */
  let open = $state(false);
  let feed = $state<Feed | null>(null);
  /** How many were unread when they were last asked for: the newest ones */
  let unread = $state(0);
  // When AniList last sent the newest ones
  let loadedAt = 0;
  // Whether the newest ones have shown since they loaded, which a load that ends after the dropdown
  // closed hasn't
  let seen = false;
  // Bumped on starting over, so an answer for the round before is dropped
  let round = 0;

  function onopen() {
    if (feed?.loading) return;
    const reuse = reusesNotifications({
      loaded: feed !== null && !feed.problem,
      loadedAt,
      bellUnread: notificationCount.unread,
      now: Date.now(),
    });
    if (reuse) {
      // Shown before, so no longer new; or showing now for the first time, still new
      if (seen) unread = 0;
      seen = true;
      return;
    }
    round++;
    feed = null;
    unread = notificationCount.unread;
    void load(1);
  }

  async function problemOf(response: Response): Promise<Problem> {
    if (response.status === 429) {
      return {
        // The automatic retry below it says that AniList is busy, and when it tries again
        message: "Your notifications couldn't be loaded yet.",
        retryAt: Date.now() + retryAfterSeconds(response.headers.get('Retry-After')) * 1000,
      };
    }
    if (response.status === 401) {
      return {
        message: 'Your AniList sign-in expired. Sign in again to see your notifications.',
        signedOut: true,
      };
    }
    return { message: "Your notifications couldn't be loaded. Please try again." };
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
    // The first page marks them read, as opening them on AniList does
    const markRead = pageNumber === 1;
    let problem: Problem | null = null;
    let result: NotificationsPage | null = null;
    try {
      const response = markRead
        ? await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        : await fetch(`/api/notifications?page=${pageNumber}`);
      if (response.ok) result = await response.json();
      else problem = await problemOf(response);
    } catch {
      problem = {
        message: navigator.onLine
          ? "Your notifications couldn't be loaded. Please try again."
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
    clearReadRetries(RETRY_KEY);
    if (markRead) {
      unread = unreadBeforeRead(result.unread, unread);
      loadedAt = Date.now();
      seen = open;
      markAllRead();
      if (list) list.scrollTop = 0;
    }
    // A notification that arrived since the last page pushes the rest down by one
    const known = new Set(feed.items.map((notification) => notification.id));
    const added = result.notifications.filter(({ id }) => !known.has(id));
    feed = {
      items: [...feed.items, ...added],
      pages: pageNumber,
      hasNextPage: result.hasNextPage,
      loading: false,
      loadingMore: false,
    };
    // The button that had focus, "Try again" or the last "Load more", went with what it loaded: focus
    // carries on from the first new notification, or the list
    await tick();
    if (!open || !list || (document.activeElement && document.activeElement !== document.body)) {
      return;
    }
    const first = pageNumber > 1 && added[0] && list.querySelector(`a[data-id="${added[0].id}"]`);
    (first instanceof HTMLElement ? first : list).focus();
  }

  // The newest ones, as many as were unread
  const fresh = $derived(
    new Set(feed?.items.slice(0, unread).map((notification) => notification.id))
  );
  const showMature = $derived(page.data.preferences?.showMature ?? false);

  const announcement = $derived.by(() => {
    if (!feed || feed.loading) return 'Loading notifications…';
    if (feed.problem) return '';
    if (feed.loadingMore) return 'Loading more notifications…';
    const count = feed.items.length;
    if (!count) return EMPTY;
    const label = `${count} ${count === 1 ? 'notification' : 'notifications'}`;
    return fresh.size ? `${label}, ${fresh.size} new` : label;
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
    if (opening) onopen();
  }}
>
  <section class="panel" aria-labelledby={heading}>
    <header>
      <div class="heading-copy">
        <h2 id={heading}>Notifications</h2>
        <p class="description">
          <a href="https://anilist.co/notifications" target="_blank" rel="noopener noreferrer"
            >Open on AniList ↗<span class="tw:sr-only"> (opens in a new tab)</span></a
          >
        </p>
      </div>
      <CloseButton label="Close notifications" onclick={() => popover?.close()} />
    </header>

    {#if open}
      <div class="list" bind:this={list} tabindex="-1" aria-busy={!feed || feed.loading}>
        {#if !feed || (feed.loading && !feed.problem)}
          <p class="message">
            <span class="tw:loading tw:loading-spinner tw:loading-sm" aria-hidden="true"></span>
            Loading notifications…
          </p>
        {:else if feed.problem}
          <div class="message">
            <p role="alert">{feed.problem.message}</p>
            {#if feed.problem.signedOut}
              <SignInButton compact />
            {:else}
              {#if feed.problem.retryAt}
                <AutoReadRetry
                  retryKey={RETRY_KEY}
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
          <p class="message">{EMPTY}</p>
        {:else}
          {#each groupByDay(feed.items, clock.now) as group (group.day)}
            <h3 class="day">{group.day}</h3>
            <ul>
              {#each group.notifications as notification (notification.id)}
                {@const text = describeNotification(notification)}
                {@const isNew = fresh.has(notification.id)}
                {@const detail = notificationDetail(notification)}
                {@const external = notification.href?.startsWith('https://') ?? false}
                <li>
                  <svelte:element
                    this={notification.href ? 'a' : 'div'}
                    class="row"
                    data-id={notification.id}
                    href={notification.href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                  >
                    <span class="thumbnail" aria-hidden="true">
                      {#if notification.media}
                        <SharedAnimePoster
                          anime={{
                            id: notification.media.id,
                            title: notification.media.title ?? '?',
                            isAdult: notification.media.isAdult,
                            coverUrl: notification.media.coverUrl,
                          }}
                          blurMature={!showMature}
                          compact
                          decorative
                        />
                      {:else if notification.actor}
                        <FriendAvatar {...notification.actor} size={40} />
                      {:else}
                        <span class="icon">
                          <svg
                            viewBox="0 0 24 24"
                            width="20"
                            height="20"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            ><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path
                              d="M10.3 21a1.94 1.94 0 0 0 3.4 0"
                            /></svg
                          >
                        </span>
                      {/if}
                    </span>
                    <!-- Who or what first, then what happened and when; the commas are for screen readers -->
                    <span class="copy">
                      <span class="title" title={text.title}>{text.title}</span><span
                        class="tw:sr-only">,</span
                      >
                      <span class="meta">
                        <span>{text.summary}</span>
                        <span aria-hidden="true">·</span>
                        <time
                          datetime={new Date(notification.createdAt).toISOString()}
                          title={formatAirDate(notification.createdAt)}
                          >{formatTimeAgo(notification.createdAt, clock.now)}</time
                        >{#if isNew}<span class="tw:sr-only">,</span>
                          <span class="new-label">New</span>{/if}
                      </span>
                      {#if detail}<span class="detail">{detail}</span>{/if}
                    </span>
                    {#if notification.href}
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
  /* Stays at the top of the list while its day's notifications scroll under it */
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
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface-muted);
    color: var(--text-accent);
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

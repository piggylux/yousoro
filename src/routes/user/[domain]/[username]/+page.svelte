<script lang="ts">
  import { beforeNavigate, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';

  import { sortWatchingList } from '#lib/anime.js';
  import AnimeCard from '#lib/components/AnimeCard.svelte';
  import BacklogBanner from '#lib/components/BacklogBanner.svelte';
  import ScorePrompt from '#lib/components/ScorePrompt.svelte';
  import YousoroCelebration from '#lib/components/YousoroCelebration.svelte';
  import { flippedCard } from '#lib/flipped-card.svelte.js';
  import { nextAiringReloadDelay, planReload, reloadsOnReturn } from '#lib/live-updates.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { AnimePageData } from '#lib/types/api.js';
  import { countColumns, getVisibleRange, type VisibleRange } from '#lib/virtual-grid.js';

  let { data }: { data: AnimePageData } = $props();

  const animeList = $derived(sortWatchingList(data.watchingList));

  // Cards slide to their new place when an update reorders the list, instead of jumping there
  const duration = $derived(prefersReducedMotion.current ? 0 : 500);

  /*
   * Virtual scrolling for long lists: only the rows on or near the screen are rendered. Shorter
   * lists render every card, so find in page works as usual
   */
  const VIRTUAL_FROM = 48;

  let grid = $state<HTMLElement>();
  // The rows last measured as visible; null until the grid has been measured
  let visible = $state<VisibleRange | null>(null);
  // While a keyboard user is in the grid, every card is rendered, so Tab reaches them all and the
  // focused card never disappears from under them
  let keyboardInGrid = $state(false);

  const virtual = $derived(animeList.length >= VIRTUAL_FROM && !keyboardInGrid);
  // Every card is rendered until the grid is measured, on the server too. The page then has its
  // full height when the browser restores a scroll position, e.g. on Back
  const range = $derived(
    virtual && visible
      ? visible
      : { start: 0, end: animeList.length, paddingTop: 0, paddingBottom: 0 }
  );
  const shownList = $derived(animeList.slice(range.start, range.end));
  const listIds = $derived(new Set(animeList.map((anime) => anime.id)));

  // The grid's columns and row height as last measured, which also place cards not rendered
  let gridShape: { columns: number; rowStride: number; rowGap: number } | null = null;

  // Every card is the same size, so the first one gives the columns and the row height
  function measureShape() {
    const first = grid?.firstElementChild;
    if (!grid || !(first instanceof HTMLElement)) return null;
    const style = getComputedStyle(grid);
    const rowGap = parseFloat(style.rowGap) || 0;
    gridShape = {
      columns: countColumns(grid.clientWidth, first.offsetWidth, parseFloat(style.columnGap) || 0),
      rowStride: first.offsetHeight + rowGap,
      rowGap,
    };
    return gridShape;
  }

  function measure() {
    const shape = measureShape();
    if (!grid || !shape) return;
    const next = getVisibleRange({
      itemCount: animeList.length,
      columns: shape.columns,
      rowStride: shape.rowStride,
      gridTop: grid.getBoundingClientRect().top,
      viewportHeight: window.innerHeight,
    });
    // Most scroll events stay within the same rows, and then nothing needs to re-render
    if (
      !visible ||
      next.start !== visible.start ||
      next.end !== visible.end ||
      next.paddingTop !== visible.paddingTop ||
      next.paddingBottom !== visible.paddingBottom
    ) {
      visible = next;
    }
  }

  // Scroll and resize events already come at most once per frame, so each one measures directly
  function remeasure() {
    if (virtual) measure();
  }

  onMount(() => {
    // Cards resize with the window, not only with the grid's width, so both are watched
    const observer = new ResizeObserver(remeasure);
    if (grid) observer.observe(grid);
    return () => {
      observer.disconnect();
      clearTimeout(highlightTimer);
      clearTimeout(busyTimer);
    };
  });

  // Measured again when the list becomes long enough, changes length, or the keyboard leaves it,
  // and when the card size setting changes the columns and the row height
  $effect(() => {
    void data.preferences.cardSize;
    if (animeList.length) remeasure();
  });

  // Focus from a click doesn't count, so clicking a card turns virtual scrolling back on
  function onGridFocusIn(event: FocusEvent) {
    keyboardInGrid = event.target instanceof Element && event.target.matches(':focus-visible');
  }

  function onGridFocusOut(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node && grid?.contains(event.relatedTarget))) {
      keyboardInGrid = false;
    }
  }

  /*
   * After a save, the list re-sorts and the card may move far away, especially in a long list. The
   * page follows it there, scrolling only if it's not already in view, and it glows for a moment
   */
  let highlightId = $state<number | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;

  async function followCard(animeId: number, positionBefore: number) {
    await tick();
    const index = animeList.findIndex((anime) => anime.id === animeId);
    if (index === -1 || index === positionBefore) return;

    // Off for a moment first, so a card saved again before the glow ends glows anew
    clearTimeout(highlightTimer);
    highlightId = null;
    await tick();
    highlightId = animeId;
    highlightTimer = setTimeout(() => (highlightId = null), 2200);

    // Where the card's row is in the grid, whether or not it's rendered: rows are all the same
    // height, and the padding of a virtual list stands in for the rows not rendered. Its badge
    // sticks out into the gap above, so that counts as part of the card
    const shape = measureShape();
    if (!grid || !shape) return;
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const cardTop = top + Math.floor(index / shape.columns) * shape.rowStride;
    const fromBadge = cardTop - shape.rowGap;
    const toBottom = cardTop + shape.rowStride - shape.rowGap;
    if (fromBadge >= window.scrollY && toBottom <= window.scrollY + window.innerHeight) return;
    window.scrollTo({
      top: Math.max(0, fromBadge - (window.innerHeight - (toBottom - fromBadge)) / 2),
      behavior: prefersReducedMotion.current ? 'instant' : 'smooth',
    });
  }

  const animeLinkFn = (animeId: number) => `https://anilist.co/anime/${animeId}/`;

  // The "Yousoro!" celebration currently playing; a new one restarts the animation
  let celebration = $state<{ kind: 'caught-up' | 'completed'; title: string; key: number } | null>(
    null
  );

  /*
   * A completed anime leaves the Watching list, so its owner is asked for a score right away, while
   * the celebration plays and it can still be set here: one anime after another when several were
   * completed. An update that already set the score isn't asked again
   */
  let toScore = $state<Anime[]>([]);
  let scoring = $state<Anime | null>(null);

  function celebrate(
    kind: 'caught-up' | 'completed',
    anime: Anime,
    { scored }: { scored: boolean }
  ) {
    celebration = { kind, title: anime.title, key: Date.now() };
    if (kind === 'completed' && data.canEdit && !scored) {
      toScore = [...toScore, anime];
      if (!scoring) askNextScore();
    }
  }

  function askNextScore() {
    scoring = null;
    const [next, ...rest] = toScore;
    if (next) {
      scoring = next;
      toScore = rest;
    }
  }

  /*
   * Live updates: the list reloads when an episode on it airs, so a caught-up anime moves up with
   * its new episode, and when the viewer comes back to the tab after a while, to show changes made
   * elsewhere. AniList can't tell the page about changes, so these are the moments worth asking
   */
  const BUSY_RETRY_MS = 30 * 1000;

  let loadedAt = Date.now();
  // Waiting for the tab to be visible again, as a hidden tab doesn't reload
  let reloadWhenVisible = false;
  let busyTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    void data.watchingList;
    loadedAt = Date.now();
  });

  function reload() {
    clearTimeout(busyTimer);
    const plan = planReload({
      hidden: document.hidden,
      busy: flippedCard.id !== null || scoring !== null,
    });
    reloadWhenVisible = plan === 'when-visible';
    if (plan === 'later') busyTimer = setTimeout(reload, BUSY_RETRY_MS);
    if (plan === 'now') void invalidateAll();
  }

  $effect(() => {
    const delay = nextAiringReloadDelay(data.watchingList, Date.now());
    if (delay === null) return;
    const timer = setTimeout(reload, delay);
    return () => clearTimeout(timer);
  });

  function onVisibilityChange() {
    if (document.hidden) return;
    if (reloadsOnReturn({ waiting: reloadWhenVisible, loadedAt, now: Date.now() })) reload();
  }

  // The prompt covers the page, but Back could still leave it with a score unasked
  beforeNavigate(({ cancel, willUnload }) => {
    if (!willUnload && scoring) cancel();
  });
</script>

<svelte:window onscroll={remeasure} onresize={remeasure} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<svelte:head>
  <title>{data.username} - Yousoro</title>
  <meta name="description" content={`${data.username}'s watching list`} />
</svelte:head>

<section>
  <!-- One compact row, so the cards start high enough for two full rows to fit on screen -->
  <div class="profile-bar">
    <div class="profile">
      {#if data.avatarUrl}
        <img class="avatar-img" src={data.avatarUrl} alt={`${data.username}'s profile picture`} />
      {/if}
      <span>
        <span class="name">{data.username}</span>
        <span class="profile-links">
          <a href={`/user/anilist/${encodeURIComponent(data.username)}/friends`}>Friends</a>
          · <a href={data.userProfileLink} target="_blank">AniList profile ↗</a>
        </span>
      </span>
    </div>

    <!-- Updates with every progress change, since the list reloads after each one -->
    <BacklogBanner
      animeList={data.watchingList}
      username={data.username}
      isOwnList={data.canEdit}
    />
  </div>

  <div
    class="anime-grid"
    data-size={data.preferences.cardSize}
    bind:this={grid}
    onfocusin={onGridFocusIn}
    onfocusout={onGridFocusOut}
    style:padding-top="{range.paddingTop}px"
    style:padding-bottom="{range.paddingBottom}px"
  >
    {#each shownList as anime, i (anime.id)}
      <!--
        Fades out a show that leaves the Watching list, e.g. once AniList marks it completed. A card
        that only scrolled out of view is removed at once, so the rows around it never shift
      -->
      <div
        animate:flip={{ duration }}
        out:fade={{ duration: listIds.has(anime.id) ? 0 : duration / 2 }}
      >
        <AnimeCard
          {anime}
          {animeLinkFn}
          canEdit={data.canEdit}
          onCaughtUp={celebrate}
          blurMature={data.preferences.blurMature}
          downloadLanguage={data.preferences.downloadLanguage}
          downloadVersion={data.preferences.downloadVersion}
          scoreFormat={data.scoreFormat}
          position={range.start + i}
          onSaved={followCard}
          highlighted={highlightId === anime.id}
        />
      </div>
    {/each}
  </div>
</section>

{#if celebration}
  {#key celebration.key}
    <YousoroCelebration
      kind={celebration.kind}
      title={celebration.title}
      onDone={() => (celebration = null)}
    />
  {/key}
{/if}

{#if scoring}
  {#key scoring.id}
    <ScorePrompt
      anime={scoring}
      format={data.scoreFormat}
      blurMature={data.preferences.blurMature}
      onClose={askNextScore}
    />
  {/key}
{/if}

<style>
  .profile-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 16px 28px;
    /* Clear space above the first row, whose badges stick out above the cards */
    margin-bottom: 72px;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }

  .name {
    display: block;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .profile-links {
    font-size: 0.85rem;
    opacity: 0.65;
  }

  .profile-links a:hover,
  .profile-links a:focus-visible {
    text-decoration: underline;
  }
  /*
   * As many card columns as fit, from one on phones up to as many as a wide screen allows. The
   * grid is centered as a block; a short last row stays left-aligned, so the order stays clear.
   */
  .anime-grid {
    --card-width: 260px;
    display: grid;
    grid-template-columns: repeat(
      auto-fit,
      minmax(min(var(--card-width), 100%), var(--card-width))
    );
    justify-content: center;
    /* Rows leave room for the badges above each card */
    gap: 28px 24px;
  }

  /*
   * The viewer's card size setting: small fits two cards side by side on any phone. The width
   * comes from the viewport, as the page is narrower by its 16px padding on each side, since a
   * percentage would mean something else on the cards, which reuse --card-width
   */
  .anime-grid[data-size='small'] {
    --card-width: min(220px, calc((100vw - 32px - 24px) / 2));
  }

  .anime-grid[data-size='large'] {
    --card-width: 300px;
  }

  /*
   * On larger screens, large cards shrink with the window height (down to 200px wide) so two full
   * rows fit without scrolling. A card is its 3:4 cover plus 108px of title and progress, and the
   * grid starts about 222px down the page; 262px also counts the gap between rows and a little slack.
   * Medium cards are about seven eighths of that size and small ones three quarters, so more fit in
   * a row
   */
  @media (min-width: 768px) {
    .anime-grid {
      --two-rows-width: calc(20px + 0.75 * ((100svh - 262px) / 2 - 108px));
      --card-width: clamp(175px, calc(0.87 * var(--two-rows-width)), 260px);
    }

    .anime-grid[data-size='small'] {
      --card-width: clamp(150px, calc(0.75 * var(--two-rows-width)), 225px);
    }

    .anime-grid[data-size='large'] {
      --card-width: clamp(200px, var(--two-rows-width), 300px);
    }
  }
</style>

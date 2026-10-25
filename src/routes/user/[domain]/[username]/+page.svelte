<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';

  import { sortWatchingList } from '#lib/anime.js';
  import AnimeCard from '#lib/components/AnimeCard.svelte';
  import BacklogBanner from '#lib/components/BacklogBanner.svelte';
  import YousoroCelebration from '#lib/components/YousoroCelebration.svelte';
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

  // Every card is the same size, so the first one gives the columns and the row height
  function measure() {
    const first = grid?.firstElementChild;
    if (!grid || !(first instanceof HTMLElement)) return;
    const style = getComputedStyle(grid);
    const next = getVisibleRange({
      itemCount: animeList.length,
      columns: countColumns(grid.clientWidth, first.offsetWidth, parseFloat(style.columnGap) || 0),
      rowStride: first.offsetHeight + (parseFloat(style.rowGap) || 0),
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
    return () => observer.disconnect();
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

  const animeLinkFn = (animeId: number) => `https://anilist.co/anime/${animeId}/`;

  // The "Yousoro!" celebration currently playing; a new one restarts the animation
  let celebration = $state<{ kind: 'caught-up' | 'completed'; title: string; key: number } | null>(
    null
  );

  function celebrate(kind: 'caught-up' | 'completed', anime: Anime) {
    celebration = { kind, title: anime.title, key: Date.now() };
  }
</script>

<svelte:window onscroll={remeasure} onresize={remeasure} />

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
    {#each shownList as anime (anime.id)}
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
    --card-width: 300px;
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
    --card-width: 400px;
  }

  /*
   * On larger screens, medium cards shrink with the window height (down to 200px wide) so two full
   * rows fit without scrolling. A card is its 3:4 cover plus 108px of title and progress, and the
   * grid starts about 222px down the page; 262px also counts the gap between rows and a little slack.
   * Small cards are about three quarters of that size, so more fit in a row, and large ones about
   * a third bigger, so fewer do
   */
  @media (min-width: 768px) {
    .anime-grid {
      --two-rows-width: calc(20px + 0.75 * ((100svh - 262px) / 2 - 108px));
      --card-width: clamp(200px, var(--two-rows-width), 300px);
    }

    .anime-grid[data-size='small'] {
      --card-width: clamp(150px, calc(0.75 * var(--two-rows-width)), 225px);
    }

    .anime-grid[data-size='large'] {
      --card-width: clamp(260px, calc(1.35 * var(--two-rows-width)), 400px);
    }
  }
</style>

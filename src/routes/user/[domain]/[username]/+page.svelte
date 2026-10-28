<script lang="ts">
  import { beforeNavigate, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';

  import {
    countBySection,
    getListSection,
    inShownSections,
    LIST_SECTION_LABELS,
    type ListSection,
    matchesSearch,
    searchIndex,
    searchWords,
    sortWatchingList,
  } from '#lib/anime.js';
  import AnimeCard from '#lib/components/AnimeCard.svelte';
  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import BacklogBanner from '#lib/components/BacklogBanner.svelte';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import EpisodeCalendar from '#lib/components/EpisodeCalendar.svelte';
  import FriendsWatchingDialog from '#lib/components/FriendsWatchingDialog.svelte';
  import FriendsWatchingLoader from '#lib/components/FriendsWatchingLoader.svelte';
  import ListFilters from '#lib/components/ListFilters.svelte';
  import ScorePrompt from '#lib/components/ScorePrompt.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import YousoroCelebration from '#lib/components/YousoroCelebration.svelte';
  import { flippedCard } from '#lib/flipped-card.svelte.js';
  import { recordOwnWatchingEntry, seedOwnAnime, withoutListOwner } from '#lib/friend-watching.js';
  import { hiddenSectionsCookie, toggleHidden } from '#lib/hidden-sections.js';
  import { expireRememberedList, recordSavedEntry } from '#lib/list-data.js';
  import { nextAiringReloadDelay, planReload, reloadsOnReturn } from '#lib/live-updates.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { AnimePageData } from '#lib/types/api.js';
  import type { FriendWatching, FriendWatchingResult } from '#lib/types/friend-watching.js';
  import { countColumns, getVisibleRange, type VisibleRange } from '#lib/virtual-grid.js';

  let { data }: { data: AnimePageData } = $props();
  const calendarView = $derived(page.url.searchParams.get('view') === 'calendar');

  // The view being looked at, as anyone would see it: without the viewer's filters or search
  const share = $derived.by(() => {
    const view = calendarView ? 'calendar' : 'list';
    const path = `/user/anilist/${encodeURIComponent(data.username)}`;
    return {
      url: `${page.url.origin}${path}${calendarView ? '?view=calendar' : ''}`,
      title: `${data.canEdit ? 'My' : `${data.username}'s`} anime ${view} on Yousoro`,
      subject: `${data.canEdit ? 'your' : `${data.username}'s`} ${view}`,
    };
  });

  let friendMatches = $state<FriendWatchingResult | null>(null);
  const visibleFriendMatches = $derived(
    friendMatches ? withoutListOwner(friendMatches.matches, data.username) : null
  );
  let friendSelection = $state<{
    title: string;
    friends: FriendWatching[];
    coverUrl?: string;
    blurCover?: boolean;
  } | null>(null);
  const friendsViewerId = $derived(page.data.user?.id ?? null);
  const friendsPageKey = $derived(`${friendsViewerId}:${data.username}`);
  $effect(() => {
    if (data.canEdit && page.data.user)
      seedOwnAnime(page.data.user.id, data.watchingList, data.preferences.showMature);
  });
  $effect(() => {
    void friendsPageKey;
    friendSelection = null;
    friendMatches = null;
  });

  function confirmSaved(saved: Anime, status: string) {
    if (data.canEdit && page.data.user) recordOwnWatchingEntry(page.data.user, saved, status);
    data = recordSavedEntry(data, saved, status);
  }

  const sortedList = $derived(sortWatchingList(data.watchingList));

  /*
   * The filters above the list show or hide its sections. The whole list is already here, so a
   * change only filters it, and a cookie remembers it for the next visit: no request at all
   */
  let hiddenSections = $derived(data.hiddenSections);
  const sectionCounts = $derived(countBySection(data.watchingList));
  /*
   * The search narrows the shown sections further; it's not remembered, unlike the filters. The
   * titles are folded once per list, so each keystroke only compares them
   */
  let search = $state('');
  let filters = $state<{ focusSearch(): void }>();
  const words = $derived(searchWords(search));
  const searching = $derived(words.length > 0);
  const searchIndexes = $derived(
    new Map(data.watchingList.map((anime) => [anime.id, searchIndex(anime)]))
  );
  const matches = (anime: Anime) => {
    const index = searchIndexes.get(anime.id);
    return index !== undefined && matchesSearch(index, words);
  };
  const animeList = $derived.by(() => {
    const shown = inShownSections(sortedList, hiddenSections);
    return searching ? shown.filter(matches) : shown;
  });
  // Anime that match but are in hidden sections, for when nothing shown does: only counted then
  const hiddenMatches = $derived(
    searching && animeList.length === 0 ? sortedList.filter(matches).length : 0
  );

  function toggleSection(section: ListSection) {
    hiddenSections = toggleHidden(hiddenSections, section);
    document.cookie = hiddenSectionsCookie(hiddenSections);
    if (movedNote?.section === section) dismissMovedNote();
  }

  /*
   * A save can move a card into a section the filters hide, as when the viewer catches up with
   * "Caught up" hidden. A note says where it went, with a button to show that section
   */
  let movedNote = $state<{ title: string; section: ListSection } | null>(null);
  let movedNoteTimer: ReturnType<typeof setTimeout> | undefined;

  function noteMovedToHidden(anime: Anime) {
    clearTimeout(movedNoteTimer);
    movedNote = { title: anime.title, section: getListSection(anime) };
    movedNoteTimer = setTimeout(dismissMovedNote, 6000);
  }

  function dismissMovedNote() {
    clearTimeout(movedNoteTimer);
    movedNote = null;
  }

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
    return () => {
      clearTimeout(highlightTimer);
      clearTimeout(busyTimer);
      clearTimeout(movedNoteTimer);
    };
  });

  // Reconnect when returning from the calendar: its grid is a new DOM element.
  $effect(() => {
    if (!grid) return;
    const observer = new ResizeObserver(remeasure);
    observer.observe(grid);
    return () => observer.disconnect();
  });

  // Measured again when the list becomes long enough, changes length, or the keyboard leaves it,
  // and when the card size setting changes the columns and the row height
  $effect(() => {
    void data.preferences.cardSize;
    void calendarView;
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
    if (index === -1) {
      // Still on the list, but in a hidden section; an anime that left the list isn't
      const moved = sortedList.find((anime) => anime.id === animeId);
      if (moved) noteMovedToHidden(moved);
      return;
    }
    if (index === positionBefore) return;

    // Off for a moment first, so a card saved again before the glow ends glows anew
    clearTimeout(highlightTimer);
    highlightId = null;
    await tick();
    highlightId = animeId;
    highlightTimer = setTimeout(() => (highlightId = null), 2200);

    // Where the card's row is in the grid, whether or not it's rendered: rows are all the same
    // height, and the padding of a virtual list stands in for the rows not rendered. Leave a
    // row gap above the card so it has some breathing room after scrolling.
    const shape = measureShape();
    if (!grid || !shape) return;
    const top = grid.getBoundingClientRect().top + window.scrollY;
    const cardTop = top + Math.floor(index / shape.columns) * shape.rowStride;
    const fromTop = cardTop - shape.rowGap;
    const toBottom = cardTop + shape.rowStride - shape.rowGap;
    if (fromTop >= window.scrollY && toBottom <= window.scrollY + window.innerHeight) return;
    window.scrollTo({
      top: Math.max(0, fromTop - (window.innerHeight - (toBottom - fromTop)) / 2),
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
    if (plan === 'now') {
      expireRememberedList(data.username);
      void invalidateAll();
    }
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
    else friendSelection = null;
  });
</script>

<svelte:window onscroll={remeasure} onresize={remeasure} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<section>
  <AutoReadRetry
    retryKey={`page:${page.data.user?.id ?? 'public'}:${page.url.pathname}:${page.url.search}`}
    retryAt={data.retryAt ?? 0}
    recovered={!data.retryAt}
    onretry={reload}
  />
  <!-- One compact row, so the cards start high enough for two full rows to fit on screen -->
  <div class="profile-bar" class:calendar-profile={calendarView}>
    <div class="profile">
      {#if data.avatarUrl}
        <img class="avatar-img" src={data.avatarUrl} alt={`${data.username}'s profile picture`} />
      {/if}
      <div>
        <div class="name-row">
          {#if calendarView}
            <span class="name">{data.username}</span>
          {:else}
            <h1 class="name">
              {data.username}<span class="tw:sr-only">'s anime watching list</span>
            </h1>
          {/if}
          <ShareButton url={share.url} title={share.title} subject={share.subject} />
        </div>
        <span class="profile-links">
          <a href={`/user/anilist/${encodeURIComponent(data.username)}/friends`}>Friends</a>
          ·
          <a href={calendarView ? page.url.pathname : `${page.url.pathname}?view=calendar`}
            >{calendarView ? 'Anime list' : 'Calendar'}</a
          >
          · <a href={data.userProfileLink} target="_blank">AniList profile ↗</a>
        </span>
      </div>
    </div>

    <!-- Updates with every progress change, since the list reloads after each one -->
    {#if !calendarView}<BacklogBanner
        animeList={data.watchingList}
        username={data.username}
        isOwnList={data.canEdit}
      />{/if}
  </div>

  {#if calendarView}
    <EpisodeCalendar
      anime={data.watchingList}
      blurMature={data.preferences.blurMature}
      contextKey={`${page.data.user?.id ?? 'public'}:${data.username}`}
    />
  {:else}
    {#if data.watchingList.length}
      <ListFilters
        bind:this={filters}
        counts={sectionCounts}
        hidden={hiddenSections}
        onToggle={toggleSection}
        bind:search
      />
    {/if}
    <!-- Tells screen readers how many anime match as the viewer types, as the grid changes silently -->
    <p class="tw:sr-only" aria-live="polite">
      {searching ? `${animeList.length} anime ${animeList.length === 1 ? 'matches' : 'match'}` : ''}
    </p>
    {#if data.watchingList.length && !animeList.length}
      <div class="empty-results">
        <h2>
          {searching
            ? hiddenMatches
              ? 'Matches in hidden sections'
              : 'No matching anime'
            : 'All sections are hidden'}
        </h2>
        <p>
          {#if hiddenMatches}
            {hiddenMatches} matching anime {hiddenMatches === 1 ? 'is' : 'are'} in hidden sections.
          {:else if searching}
            Try another title, or clear your search to see the list.
          {:else}
            Choose a section above, or show them all.
          {/if}
        </p>
        <div class="empty-actions">
          {#if searching}
            <button
              type="button"
              class="tw:btn tw:btn-sm"
              onclick={() => {
                search = '';
                filters?.focusSearch();
              }}>Clear search</button
            >
          {/if}
          {#if hiddenSections.length}
            <button
              type="button"
              class="tw:btn tw:btn-sm"
              onclick={() => {
                hiddenSections = [];
                document.cookie = hiddenSectionsCookie(hiddenSections);
                dismissMovedNote();
                filters?.focusSearch();
              }}>Show all sections</button
            >
          {/if}
        </div>
      </div>
    {/if}

    {#if page.data.user}
      <FriendsWatchingLoader
        contextKey={data.username}
        viewerId={page.data.user.id}
        mediaIds={data.watchingList.map((anime) => anime.id)}
        onresult={(result) => (friendMatches = result)}
      />
    {/if}
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
            friendsWatching={page.data.user
              ? visibleFriendMatches
                ? (visibleFriendMatches[anime.id] ?? [])
                : null
              : undefined}
            onShowFriends={() =>
              (friendSelection = {
                title: anime.title,
                coverUrl: anime.thumbnailUrl,
                blurCover: anime.isAdult && data.preferences.blurMature,
                friends: visibleFriendMatches?.[anime.id] ?? [],
              })}
            {anime}
            {animeLinkFn}
            canEdit={data.canEdit}
            compact={data.preferences.cardSize === 'small'}
            onCaughtUp={celebrate}
            blurMature={data.preferences.blurMature}
            downloadLanguage={data.preferences.downloadLanguage}
            downloadVersion={data.preferences.downloadVersion}
            scoreFormat={data.scoreFormat}
            position={range.start + i}
            onConfirmed={confirmSaved}
            onSaved={followCard}
            highlighted={highlightId === anime.id}
          />
        </div>
      {/each}
    </div>
  {/if}
</section>

<FriendsWatchingDialog selection={friendSelection} onclose={() => (friendSelection = null)} />

{#if movedNote}
  <div class="moved-note" role="status">
    <span>
      {movedNote.title} moved to {LIST_SECTION_LABELS[movedNote.section]}, which the filters hide.
    </span>
    <button
      type="button"
      class="tw:btn tw:btn-xs show-section"
      onclick={() => movedNote && toggleSection(movedNote.section)}
    >
      Show {LIST_SECTION_LABELS[movedNote.section]}
    </button>
    <CloseButton label="Dismiss notification" onclick={dismissMovedNote} />
  </div>
{/if}

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
  /* Floats just below the header, as the card that moved may have been anywhere down the list */
  .moved-note {
    position: fixed;
    top: 72px;
    left: 50%;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: calc(100vw - 32px);
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    color: var(--text-heading);
    font-size: 0.9rem;
    translate: -50% 0;
    animation: note-in 0.25s ease-out;
  }

  .show-section {
    flex: none;
    border-color: var(--text-accent);
    background: var(--sea-blue);
    color: #ffffff;
  }

  .moved-note > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .show-section:hover {
    border-color: var(--text-heading);
    background: var(--navy);
  }

  @keyframes note-in {
    from {
      opacity: 0;
      translate: -50% -8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .moved-note {
      animation: none;
    }
  }

  .empty-results {
    max-width: 36rem;
    margin: 24px auto;
    padding: 32px 16px;
    color: var(--text-accent);
    text-align: center;
  }

  .empty-results h2 {
    margin-bottom: 8px;
    color: var(--text-heading);
    font-size: 1.125rem;
    font-weight: 600;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    margin-top: 20px;
  }

  .empty-actions button {
    min-height: 44px;
    padding-inline: 16px;
  }

  /*
   * The user row sits at the top, not centred on the backlog banner beside it, so it stays in place
   * when switching to the calendar, which has no banner
   */
  .profile-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px 28px;
    margin-bottom: 24px;
  }
  /* The calendar's own heading follows, closer than the list's search and filters */
  .calendar-profile {
    margin-bottom: 12px;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .avatar-img {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    box-shadow: none;
  }

  .profile > div {
    min-width: 0;
  }

  .name {
    display: block;
    min-width: 0;
    font-size: 1.25rem;
    font-weight: 700;
    /* AniList names are one word of up to 20 letters, wider than a phone has room for */
    overflow-wrap: anywhere;
  }

  /* A long name wraps the share button onto its own line rather than squeezing either */
  .name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 4px;
  }

  .profile-links {
    font-size: 0.85rem;
    opacity: 1;
    color: var(--text-accent);
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
    /* Status badges stay inside the cards; gaps separate rows evenly. */
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
   * rows fit without scrolling. A card is its 3:4 cover plus about 146px of status, title, and
   * progress. The grid starts about 242px down the page, below the filters; 282px counts the row gap
   * and a little slack.
   * Medium cards are about seven eighths of that size and small ones three quarters, so more fit in
   * a row
   */
  @media (min-width: 768px) {
    .anime-grid {
      --two-rows-width: calc(20px + 0.75 * ((100svh - 282px) / 2 - 146px));
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

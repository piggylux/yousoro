<script lang="ts">
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';

  import {
    currentSeason,
    foundState,
    listedLookup,
    nextSeason,
    seasonLineup,
    seasonName,
    seasonSlug,
    seasonStartMonth,
    seasonTiming,
    type AnimeSeason,
    type FoundState,
    type SeasonAnime,
    type WatchedAnime,
  } from '#lib/anime-search.js';
  import { matchesSearch, searchIndex, searchWords } from '#lib/anime.js';
  import AddToListActions from '#lib/components/AddToListActions.svelte';
  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import ListFilters from '#lib/components/ListFilters.svelte';
  import SeasonAnimeDialog from '#lib/components/SeasonAnimeDialog.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { ListAdds } from '#lib/list-adds.svelte.js';
  import { viewerKey } from '#lib/list-data.js';
  import { noteListMove } from '#lib/list-moves.js';
  import { formatStartDate, SHORT_EPISODES } from '#lib/planning.js';
  import {
    rankSeason,
    SEASON_SORTS,
    seasonGenres,
    sortSeason,
    type SeasonPick,
    type SeasonSort,
  } from '#lib/season-picks.js';
  import { loadSeasonTaste, type SeasonTasteState } from '#lib/season-taste.js';
  import { DOMAIN_NAMES, LIST_NAMES, listPath } from '#lib/types/domain.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const domain = $derived(data.domain);
  const username = $derived(data.username);
  const season = $derived(data.season);
  // Read again only when these change, not when other page data does, as after a settings change
  const seasonKey = $derived(seasonSlug(data.season));
  const viewer = $derived(viewerKey(data.user, data.malUser));
  const service = $derived(DOMAIN_NAMES[domain]);
  const showMature = $derived(data.preferences.showMature);
  const blurMature = $derived(data.preferences.blurMature);

  /*
   * The owner's taste, read once in the tab for their list, whichever season is shown: one request
   * to AniList or MyAnimeList, or none when the tab read it in the last five minutes
   */
  let taste = $state<SeasonTasteState>({ status: 'loading' });
  let tasteAttempt = $state(0);
  // Whose taste was asked for last: another list starts over, while a retry keeps what's shown,
  // the season by popularity, until it's answered
  let tasteFor = '';
  $effect(() => {
    const [who, list, name] = [viewer, domain, username];
    void tasteAttempt;
    let active = true;
    const asked = `${who}:${list}:${name.toLowerCase()}`;
    if (asked !== tasteFor) taste = { status: 'loading' };
    tasteFor = asked;
    loadSeasonTaste(who, list, name).then((state) => {
      if (active) taste = state;
    });
    return () => {
      active = false;
    };
  });

  /*
   * The season's anime, asked of AniList straight from the browser, on the viewer's own allowance:
   * up to three requests a season, once a visit. Switching season leaves the earlier one unanswered
   */
  type LineupState =
    | { status: 'loading' }
    | { status: 'ready'; anime: SeasonAnime[] }
    | { status: 'failed'; message: string; retryAt: number };
  let lineup = $state<LineupState>({ status: 'loading' });
  let lineupAttempt = $state(0);
  $effect(() => {
    void seasonKey;
    void lineupAttempt;
    const mature = showMature;
    const asked = untrack(() => season);
    const controller = new AbortController();
    lineup = { status: 'loading' };
    seasonLineup(asked, { showMature: mature, signal: controller.signal }).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        lineup =
          'results' in outcome
            ? { status: 'ready', anime: outcome.results }
            : {
                status: 'failed',
                message: outcome.message,
                retryAt: outcome.retryAfter ? Date.now() + outcome.retryAfter * 1000 : 0,
              };
      },
      // Aborted for another season, which shows its own
      () => {}
    );
    return () => controller.abort();
  });

  const tasteData = $derived(taste.status === 'ready' ? taste.taste : null);
  const canEdit = $derived(tasteData?.canEdit ?? false);
  // As the service spells it once read, as typed until then
  const ownerName = $derived(tasteData?.username ?? username);
  // Ranked once both are in, so nothing moves about as the taste arrives
  const ranked = $derived(
    lineup.status === 'ready' && taste.status !== 'loading'
      ? rankSeason(lineup.anime, tasteData, {
          domain,
          voice: { name: canEdit ? null : ownerName },
        })
      : null
  );

  /*
   * Where each anime is on the owner's lists, as the anime search shows it: the Watching list by
   * AniList id, the other lists by the list's own service's id
   */
  const listed = $derived(tasteData ? listedLookup(tasteData.listedIds) : null);
  const watching = $derived.by(() => {
    const byId = new Map<number, WatchedAnime>();
    if (!tasteData || lineup.status !== 'ready') return byId;
    const byKey = new Map(
      lineup.anime.map((anime) => [domain === 'anilist' ? anime.id : anime.malId, anime])
    );
    for (const { id, progress, rewatching } of tasteData.watching) {
      const anime = byKey.get(id);
      if (anime) {
        byId.set(anime.id, {
          currentEpisode: progress,
          numberEpisodes: anime.episodes ?? 0,
          rewatching,
        });
      }
    }
    return byId;
  });
  const whereOf = (anime: SeasonAnime) => foundState(anime, { domain, watching, listed });
  /*
   * Where an anime is, as the viewer reads it: "On your plan list" to the owner, and on someone
   * else's list to anyone else
   */
  function statusOf(anime: SeasonAnime, where: FoundState) {
    if (canEdit || where.kind !== 'listed') return adds.statusFor(anime, where);
    const list = where.list === 'PLANNING' ? 'plan' : LIST_NAMES[domain][where.list];
    return `On ${ownerName}'s ${list} list`;
  }

  // On a list before the page opened; one added here stays among the new ones, in sight
  const onLists = (anime: SeasonAnime) => {
    const { kind } = whereOf(anime);
    return (kind === 'watching' || kind === 'listed') && !adds.isAdded(anime.id);
  };

  // Said by a live region that's there from the start, as one added along with its words often isn't
  let announcement = $state('');
  const moveContext = () => ({
    domain,
    username: ownerName,
    friendsViewer: domain === 'anilist' && canEdit ? data.user : null,
  });
  /*
   * What was added from here, for this list alone: going to another list's season page keeps the
   * page, so it starts over then
   */
  const listKey = $derived(`${domain}:${username.toLowerCase()}`);
  const adds = $derived.by(() => {
    void listKey;
    return new ListAdds({
      domain: () => domain,
      signedIn: () => page.data,
      announce: (text) => (announcement = text),
      onAdded: (anime, list, progress) => noteListMove(moveContext(), anime, { list, progress }),
      onUndone: (anime, list) => noteListMove(moveContext(), anime, { list, undone: true }),
    });
  });

  /*
   * The whole season, filtered and sorted as the viewer chooses. The sections above it show the
   * best fits whatever the filters are
   */
  let search = $state('');
  let onlyNew = $state(false);
  let onlyShort = $state(false);
  let genre = $state('');
  let sort = $state<SeasonSort>('fit');
  const words = $derived(searchWords(search));
  // Each title folded for the search once a season, rather than on every keystroke
  const searchIndexes = $derived(
    new Map(
      lineup.status === 'ready' ? lineup.anime.map((anime) => [anime.id, searchIndex(anime)]) : []
    )
  );
  const genres = $derived(lineup.status === 'ready' ? seasonGenres(lineup.anime) : []);
  const isShort = (anime: SeasonAnime) =>
    anime.episodes !== null && anime.episodes <= SHORT_EPISODES;
  const shown = $derived.by(() => {
    if (!ranked) return [];
    const kept = ranked.all.filter(
      ({ anime }) =>
        (!onlyNew || !onLists(anime)) &&
        (!onlyShort || isShort(anime)) &&
        (!genre || anime.genres.includes(genre)) &&
        (!words.length || matchesSearch(searchIndexes.get(anime.id)!, words))
    );
    return sortSeason(kept, sort);
  });
  const filterChips = $derived(
    ranked
      ? [
          {
            key: 'new',
            label: canEdit ? 'Not on my lists' : `Not on ${ownerName}'s lists`,
            count: ranked.all.filter(({ anime }) => !onLists(anime)).length,
            pressed: onlyNew,
          },
          {
            key: 'short',
            label: `≤ ${SHORT_EPISODES} episodes`,
            count: ranked.all.filter(({ anime }) => isShort(anime)).length,
            pressed: onlyShort,
          },
        ]
      : []
  );
  function toggleFilter(key: string) {
    if (key === 'new') onlyNew = !onlyNew;
    else if (key === 'short') onlyShort = !onlyShort;
  }
  function clearFilters() {
    search = '';
    onlyNew = onlyShort = false;
    genre = '';
  }

  /*
   * Anime are added a batch at a time, as a season can hold 150 and each has its buttons. A new
   * season, search, filter or order starts with the first batch
   */
  const BATCH = 48;
  let limit = $derived.by(() => {
    void shown;
    return BATCH;
  });
  let allList = $state<HTMLElement>();
  async function showMore() {
    const first = limit;
    limit += BATCH;
    await tick();
    allList?.children[first]?.querySelector<HTMLElement>('.tile-open')?.focus();
  }

  // The seasons to switch between: the one airing and the next, and an older one shown by its link
  const airing = currentSeason();
  const upcoming = nextSeason(airing);
  const sameSeason = (a: AnimeSeason, b: AnimeSeason) => a.season === b.season && a.year === b.year;
  const seasons = $derived(
    sameSeason(season, airing) || sameSeason(season, upcoming)
      ? [airing, upcoming]
      : seasonTiming(season) === 'past'
        ? [season, airing, upcoming]
        : [airing, upcoming, season]
  );
  const seasonPath = (option: AnimeSeason) =>
    `${listPath(domain, username)}/season/${seasonSlug(option)}`;
  const monthName = (month: number) =>
    new Date(2000, month, 1).toLocaleString('en', { month: 'long' });
  function when(option: AnimeSeason) {
    const timing = seasonTiming(option);
    if (timing === 'airing') return 'Airing now';
    return timing === 'upcoming' ? `From ${monthName(seasonStartMonth(option))}` : 'Aired';
  }

  // Counts down to when "Try again" can be used, while the service is busy, and stops there
  const tasteRetryAt = $derived(taste.status === 'busy' ? taste.retryAt : 0);
  const lineupRetryAt = $derived(lineup.status === 'failed' ? lineup.retryAt : 0);
  let now = $state(Date.now());
  $effect(() => {
    const until = Math.max(tasteRetryAt, lineupRetryAt);
    if (until <= Date.now()) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
      if (now >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });
  const waitText = (until: number) =>
    now < until ? `Try again in ${Math.ceil((until - now) / 1000)}s` : 'Try again';

  const listUrl = $derived(listPath(domain, ownerName));
  const count = (value: number) => value.toLocaleString('en');
  const you = $derived(canEdit ? 'you' : ownerName);
  const your = $derived(canEdit ? 'your' : `${ownerName}'s`);

  /*
   * A tile's corner: where the anime is on the owner's lists, or added to from here, or else the
   * day an announced one starts. The details say more
   */
  function badgeOf(anime: SeasonAnime, where: FoundState) {
    const added = adds.get(anime.id)?.added;
    if (added) return mark(added === 'CURRENT' ? 'Watching' : 'Planned');
    if (where.kind === 'watching') return mark(where.anime.rewatching ? 'Rewatching' : 'Watching');
    if (where.kind === 'listed') {
      return mark(where.list === 'PLANNING' ? 'Planned' : LIST_NAMES[domain][where.list]);
    }
    const badge = formatStartDate(anime.startDate, { short: true, withYear: false });
    if (anime.status !== 'NOT_YET_RELEASED' || !badge) return undefined;
    return { badge, label: `starts ${formatStartDate(anime.startDate, { withYear: false })}` };
  }
  const mark = (list: string) => ({ badge: list, label: list.toLowerCase() });

  // What a tile says of why it's here: what to know first, then the strongest reasons
  const whyLines = ({ note, reasons }: SeasonPick) =>
    [...(note ? [note] : []), ...reasons].slice(0, 2);

  /*
   * What the picks are ranked by. AniList only takes recommendations once a season airs, so an
   * announced season goes by themes, studios and genres alone
   */
  const picksNote = $derived.by(() => {
    const verb = (plural: string, singular: string) => (canEdit ? plural : singular);
    if (ranked?.byScores) {
      return ranked.byRecommendations
        ? `New to ${you}. Each is ranked by how ${you} scored the anime its fans recommend, and how ${you} ${verb('score', 'scores')} its themes, studios and genres.`
        : `New to ${you}, ranked by how ${you} ${verb('score', 'scores')} their themes, studios and genres.`;
    }
    return ranked?.byRecommendations
      ? `New to ${you}. Each is ranked by whether ${you} ${verb('have', 'has')} watched the anime its fans recommend, and by the themes, studios and genres ${you} ${verb('watch', 'watches')} most.`
      : `New to ${you}, ranked by the themes, studios and genres ${you} ${verb('watch', 'watches')} most.`;
  });

  /*
   * The anime whose details are open. Closing them returns focus to its tile, as a native dialog
   * does; another season or list closes them
   */
  let selected = $state<SeasonPick | null>(null);
  $effect(() => {
    void seasonKey;
    void listKey;
    selected = null;
  });
  const selectedWhere = $derived(selected ? whereOf(selected.anime) : null);
</script>

<!--
  One anime of the season, as a tile like every other: its cover and title, which open its details,
  why it's here in two short lines, and the one thing to do with it, in line with the tiles beside
  it. Whatever doesn't fit is in the details
-->
{#snippet tile(pick: SeasonPick, section: string)}
  {@const anime = pick.anime}
  {@const where = whereOf(anime)}
  {@const badge = badgeOf(anime, where)}
  <li class="season-tile" data-anime={anime.id} data-section={section}>
    <button
      type="button"
      class="tile-open"
      aria-haspopup="dialog"
      onclick={() => (selected = pick)}
    >
      <SharedAnimePoster
        anime={{
          id: anime.id,
          title: anime.title,
          isAdult: anime.isAdult,
          coverUrl: anime.coverUrl,
        }}
        decorative
        {blurMature}
        detail={badge}
      />
      <span class="tw:sr-only">{anime.title}{badge ? `, ${badge.label}` : ''}</span>
    </button>
    <div class="tile-why">
      {#each whyLines(pick) as line (line)}<p>{line}</p>{/each}
    </div>
    {#if canEdit}
      <div class="tile-actions">
        <AddToListActions
          {adds}
          {anime}
          {where}
          known
          focusFallback={() =>
            document.querySelector<HTMLElement>(
              `[data-section="${section}"][data-anime="${anime.id}"] .tile-open`
            )}
        />
      </div>
    {/if}
  </li>
{/snippet}

{#snippet skeleton()}
  <ul class="tile-grid" aria-hidden="true">
    {#each Array.from({ length: 12 }, (_, index) => index) as index (index)}
      <li class="season-tile">
        <span class="skeleton-poster"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line short"></span>
      </li>
    {/each}
  </ul>
{/snippet}

<AutoReadRetry
  retryKey={`season-taste:${domain}:${username}`}
  retryAt={tasteRetryAt}
  recovered={taste.status === 'ready'}
  {service}
  onretry={() => tasteAttempt++}
/>
<AutoReadRetry
  retryKey={`season-lineup:${seasonKey}`}
  retryAt={lineupRetryAt}
  recovered={lineup.status === 'ready'}
  onretry={() => lineupAttempt++}
/>

<section class="season-page">
  <header class="season-header">
    <div class="heading-copy">
      <h1>{seasonName(season)}, picked for {canEdit ? 'you' : ownerName}</h1>
      <p class="summary">
        {#if lineup.status === 'ready'}
          {lineup.anime.length === 1 ? 'One series' : `${count(lineup.anime.length)} series`}
          {seasonTiming(season) === 'upcoming' ? 'announced' : 'this season'}
          {#if ranked?.tasteKnown && tasteData}
            · Ranked by {your}
            {ranked.byScores
              ? `${count(tasteData.scored)} ${tasteData.scored === 1 ? 'score' : 'scores'}`
              : `${count(tasteData.watched)} anime`}{/if}
        {:else}
          Series and online releases, ranked by {your} scores
        {/if}
      </p>
    </div>
    <a class="tw:btn back-link" href={listUrl}
      ><span aria-hidden="true">←</span> {canEdit ? 'Your watching list' : `${ownerName}'s list`}</a
    >
  </header>

  <nav class="season-switch" aria-label="Seasons">
    {#each seasons as option (seasonSlug(option))}
      <a
        href={seasonPath(option)}
        aria-current={sameSeason(option, season) ? 'page' : undefined}
        data-sveltekit-noscroll
      >
        <span class="season-name">{seasonName(option)}</span>
        <span class="season-when">{when(option)}</span>
      </a>
    {/each}
  </nav>

  {#if taste.status === 'missing'}
    <div class="notice" role="status">
      <h2>{taste.message}</h2>
      <p>The season is shown by popularity instead.</p>
    </div>
  {:else if taste.status === 'busy' || taste.status === 'failed'}
    <div class="notice" role="status">
      <h2>
        {taste.status === 'busy'
          ? `${service} is busy, so these aren't ranked for ${you} yet`
          : `${service} isn't answering, so these aren't ranked for ${you} yet`}
      </h2>
      <p>The season is shown by popularity until {your} list can be read.</p>
      <button
        type="button"
        class="tw:btn"
        disabled={now < tasteRetryAt}
        onclick={() => tasteAttempt++}>{waitText(tasteRetryAt)}</button
      >
    </div>
  {:else if ranked && !ranked.tasteKnown}
    <div class="notice" role="status">
      <h2>{canEdit ? 'Score a few anime to sharpen these picks' : `Not much to go on yet`}</h2>
      <p>
        {canEdit
          ? `Picks learn from how you score anime on ${service}. Until you've scored a few, the season is shown by popularity.`
          : `${ownerName} hasn't scored enough anime for picks yet, so the season is shown by popularity.`}
      </p>
    </div>
  {/if}

  {#if lineup.status === 'failed'}
    <div class="notice" role="alert">
      <h2>{lineup.message}</h2>
      <button
        type="button"
        class="tw:btn"
        disabled={now < lineupRetryAt}
        onclick={() => lineupAttempt++}>{waitText(lineupRetryAt)}</button
      >
    </div>
  {:else if !ranked}
    <p class="tw:sr-only" role="status">Reading {seasonName(season)}…</p>
    <section class="season-section" aria-hidden="true">
      <span class="skeleton-heading"><span></span></span>
      {@render skeleton()}
    </section>
  {:else if ranked.all.length === 0}
    <div class="empty-state">
      <h2>Nothing announced yet</h2>
      <p>AniList doesn't list any series for {seasonName(season)} yet. Check back closer to it.</p>
    </div>
  {:else}
    {#if ranked.continuing.length}
      <section class="season-section" aria-labelledby="continuing-heading">
        <h2 id="continuing-heading">Continuing what {you} watched</h2>
        <ul class="tile-grid">
          {#each ranked.continuing as pick (pick.anime.id)}{@render tile(pick, 'continuing')}{/each}
        </ul>
      </section>
    {/if}

    {#if ranked.picks.length}
      <section class="season-section" aria-labelledby="picks-heading">
        <h2 id="picks-heading">Picked for {you}</h2>
        <p class="section-note">{picksNote}</p>
        <ul class="tile-grid">
          {#each ranked.picks as pick (pick.anime.id)}{@render tile(pick, 'picks')}{/each}
        </ul>
      </section>
    {/if}

    <section class="all-section" aria-labelledby="all-heading">
      <h2 id="all-heading">All of {seasonName(season)}</h2>
      <ListFilters chips={filterChips} chipsLabel="Show only" onToggle={toggleFilter} bind:search>
        {#if genres.length}
          <select class="tw:select" aria-label="Genre" bind:value={genre}>
            <option value="">All genres</option>
            {#each genres as { genre: name, count: total } (name)}
              <option value={name}>{name} ({count(total)})</option>
            {/each}
          </select>
        {/if}
        <select class="tw:select" aria-label="Order" bind:value={sort}>
          {#each Object.entries(SEASON_SORTS) as [key, label] (key)}
            <option value={key}>{key === 'fit' ? `Best fit for ${you}` : label}</option>
          {/each}
        </select>
      </ListFilters>
      <p class="tw:sr-only" role="status" aria-live="polite">
        {shown.length === 1 ? 'One anime' : `${count(shown.length)} anime`} shown
      </p>
      {#if shown.length}
        <ul class="tile-grid" bind:this={allList}>
          {#each shown.slice(0, limit) as pick (pick.anime.id)}{@render tile(pick, 'all')}{/each}
        </ul>
        {#if shown.length > limit}
          <button type="button" class="tw:btn show-more" onclick={showMore}>
            Show more ({count(shown.length - limit)} left)
          </button>
        {/if}
      {:else}
        <div class="empty-state">
          <h2>No matching anime</h2>
          <button type="button" class="tw:btn" onclick={clearFilters}
            >Clear search and filters</button
          >
        </div>
      {/if}
    </section>
  {/if}

  <p class="tw:sr-only" role="status">{announcement}</p>
</section>

<SeasonAnimeDialog
  pick={selected}
  where={selectedWhere}
  status={selected && selectedWhere ? statusOf(selected.anime, selectedWhere) : null}
  done={selected && selectedWhere ? adds.done(selected.anime, selectedWhere) : false}
  {domain}
  {canEdit}
  {adds}
  forWhom={you}
  {blurMature}
  onclose={() => (selected = null)}
/>

<style>
  .season-page {
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    max-width: 70rem;
    margin: 24px auto 0;
  }

  /* A long name wraps the back link onto its own line rather than squeezing either */
  .season-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 24px;
  }

  .heading-copy {
    min-width: 0;
  }

  h1 {
    color: var(--text-heading);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.25;
    /* AniList names are one word of up to 20 letters, wider than a phone has room for */
    overflow-wrap: anywhere;
  }

  .summary {
    margin-top: 10px;
    color: var(--text-accent);
    font-size: 0.86rem;
  }

  .back-link {
    flex: none;
    min-height: 44px;
  }

  /* The season shown is selected, so it's outlined in blue */
  .season-switch {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .season-switch a {
    display: flex;
    flex: 1 1 10rem;
    flex-direction: column;
    justify-content: center;
    max-width: 16rem;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
  }

  .season-switch a:hover {
    border-color: var(--text-accent);
  }

  .season-switch a[aria-current='page'] {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }

  .season-name {
    color: var(--text-heading);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .season-when {
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .notice {
    padding: 16px 20px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .notice h2 {
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .notice p {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.875rem;
  }

  .notice button {
    min-height: 44px;
    margin-top: 12px;
  }

  .season-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .season-section h2 {
    color: var(--text-heading);
    font-size: 1.125rem;
    font-weight: 600;
  }

  /* The filters keep the space under them they have on every list */
  .all-section h2 {
    margin-bottom: 14px;
    color: var(--text-heading);
    font-size: 1.125rem;
    font-weight: 600;
  }

  .all-section .show-more {
    display: flex;
    margin: 16px auto 0;
  }

  .section-note {
    margin-top: -6px;
    color: var(--text-accent);
    font-size: 0.85rem;
  }

  /*
   * Tiles of one size: the cover, room for two lines of why, and the buttons, which line up across
   * each row. Nothing in a tile opens or grows; the details are in their own dialog
   */
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
    gap: 20px 16px;
    padding: 0;
    list-style: none;
  }

  .season-tile {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .tile-open {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
    transition: translate 180ms ease;
  }

  .tile-open:hover {
    translate: 0 -4px;
  }

  .tile-open:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
  }

  /* Each line two at most, with room kept for two of them, whatever a tile has to say */
  .tile-why {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: calc(5.4em + 4px);
    color: var(--text-accent);
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .tile-why p {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  /* At the foot of the tile, as narrow as a phone's row (see AddToListActions) */
  .tile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: auto;
    container-type: inline-size;
  }

  @media (prefers-reduced-motion: reduce) {
    .tile-open {
      transition: none;
    }

    .tile-open:hover {
      translate: none;
    }
  }

  .show-more {
    min-height: 44px;
  }

  .empty-state {
    max-width: 36rem;
    margin: 12px auto;
    padding: 24px 16px;
    color: var(--text-accent);
    text-align: center;
  }

  .empty-state h2 {
    margin-bottom: 8px;
    color: var(--text-heading);
    font-size: 1.05rem;
    font-weight: 600;
  }

  .empty-state button {
    min-height: 44px;
    margin-top: 12px;
  }

  .skeleton-heading span,
  .skeleton-poster,
  .skeleton-line {
    display: block;
    border-radius: var(--radius-control);
    background: var(--surface-muted);
  }

  .skeleton-heading span {
    width: 12rem;
    height: 1.25rem;
  }

  .skeleton-poster {
    aspect-ratio: 3 / 4;
  }

  .skeleton-line {
    width: 85%;
    height: 0.75rem;
  }

  .skeleton-line.short {
    width: 55%;
  }

  @media (max-width: 480px) {
    .season-switch a {
      max-width: none;
    }
  }
</style>

<script lang="ts">
  import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
  import { tick } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';

  import { matchesSearch, searchIndex, searchWords } from '#lib/anime.js';
  import { forgetChange, recordListChange, updateChange } from '#lib/change-history.js';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import ListFilters from '#lib/components/ListFilters.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { noteListMove } from '#lib/list-moves.js';
  import {
    countAnime,
    describePlanned,
    distinctEnglishTitle,
    forgetPlanned,
    groupSeries,
    markStarted,
    pickAnother,
    PLAN_FILTERS,
    PLAN_SORTS,
    type PlanFilter,
    type PlannedSeries,
    plannedKey,
    type PlanSort,
    seriesGenres,
    seriesSteps,
    sortSeries,
  } from '#lib/planning.js';
  import { formatMeanScore } from '#lib/score.js';
  import type { PlannedAnime, PlannedSequel } from '#lib/types/anime.js';
  import type { LinkedFailure } from '#lib/types/api.js';
  import { animePageUrl, DOMAIN_NAMES, listPath } from '#lib/types/domain.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const service = $derived(DOMAIN_NAMES[data.domain]);
  const listUrl = $derived(listPath(data.domain, data.username));

  // The search isn't remembered; the titles are folded once per list, so each keystroke only compares
  let search = $state('');
  let filters = $state<{ focusSearch(): void }>();
  const words = $derived(searchWords(search));
  const searchIndexes = $derived(
    new Map(data.planned.map((anime) => [plannedKey(anime), searchIndex(anime)]))
  );

  // Sequels go under the part to watch first, so every row leads with an anime to start
  const series = $derived(groupSeries(data.planned));
  const seriesKey = ({ parts }: PlannedSeries) => plannedKey(parts[0]);

  /*
   * The order and filters go by the part each series starts with, the one to watch next, while the
   * search finds a series by any of its parts. None is remembered, and a new list starts without a
   * genre, as each list has its own
   */
  let sort = $state<PlanSort>('planned');
  let only = $state<PlanFilter[]>([]);
  let genre = $derived.by(() => {
    void data.planned;
    return '';
  });
  const genres = $derived(seriesGenres(series));
  const filterChips = $derived(
    (Object.keys(PLAN_FILTERS) as PlanFilter[]).map((key) => ({
      key,
      label: PLAN_FILTERS[key].label,
      count: countAnime(series.filter(({ parts }) => PLAN_FILTERS[key].matches(parts[0]))),
      pressed: only.includes(key),
    }))
  );
  const narrowed = $derived(words.length > 0 || only.length > 0 || genre !== '');
  const shown = $derived(
    sortSeries(
      series.filter(
        ({ parts }) =>
          (!words.length ||
            parts.some((anime) => matchesSearch(searchIndexes.get(plannedKey(anime))!, words))) &&
          only.every((key) => PLAN_FILTERS[key].matches(parts[0])) &&
          (!genre || parts[0].genres.includes(genre))
      ),
      sort
    )
  );
  // Like the header and the filters, this counts every planned anime shown, not each series
  const shownCount = $derived(countAnime(shown));

  function toggleFilter(key: string) {
    const filter = key as PlanFilter;
    only = only.includes(filter) ? only.filter((other) => other !== filter) : [...only, filter];
  }

  function clearFilters() {
    search = '';
    only = [];
    genre = '';
    filters?.focusSearch();
  }

  /*
   * Rows are added a batch at a time, as a plan list can be over a thousand long and every row slows
   * down opening the page and searching it. A new list, search, filter or order starts with the
   * first batch
   */
  const BATCH = 100;
  let limit = $derived.by(() => {
    void shown;
    return BATCH;
  });
  let rows = $state<HTMLElement>();

  // Focus moves to the first row added, so keyboard users carry on from where the list grew
  async function showMore() {
    const first = limit;
    limit += BATCH;
    await tick();
    rows?.children[first]?.querySelector('a')?.focus();
  }

  /*
   * What happened to each anime the viewer started watching or removed here, and what's being
   * saved (`doing`). The answer updates its row, and the plan list isn't read again: the anime leaves
   * it on the next visit. One whose change on the linked account failed stays started, removed or
   * put back while that's tried again; `linkedRemoved` says Remove took it off there too, for Undo
   */
  let starts = $state<
    Record<
      string,
      | {
          saving: boolean;
          doing?: 'start' | 'remove' | 'undo';
          started: boolean;
          removed?: boolean;
          linkedRemoved?: boolean;
          linked?: LinkedFailure;
          message?: string;
          /** The start or removal in the history of recent changes, which Undo takes off it */
          changeId?: string;
        }
      | undefined
    >
  >({});
  $effect(() => {
    void data.planned;
    starts = {};
  });

  // The anime on this list by their AniList id, so an anime can find the earlier parts it continues
  const byId = $derived(
    new Map(
      data.planned.flatMap((anime) => (anime.id === null ? [] : [[anime.id, anime] as const]))
    )
  );
  // Started or removed here, so it's no longer one to plan
  const isDone = (anime: PlannedAnime) => {
    const start = starts[plannedKey(anime)];
    return Boolean(start?.started || start?.removed);
  };

  /*
   * Whether an anime can be started here: it isn't yet, and every earlier part still on the list
   * has been, or was taken off it. Reading `starts` keeps this live, so starting a part offers the
   * next one
   */
  const ready = (anime: PlannedAnime) =>
    !isDone(anime) &&
    anime.prequels.every((id) => {
      const prequel = byId.get(id);
      return !prequel || isDone(prequel);
    });

  // The part of a series to watch next: the first one not started or removed here
  const nextPart = ({ parts }: PlannedSeries) => parts.find((anime) => !isDone(anime));

  /*
   * An anime picked at random to help choose what to start: the next part of one of the series
   * shown. It's shown above the list rather than found in it, which would mean adding every row up
   * to it. It stays as it was started, and a new list forgets it
   */
  let picked = $derived.by(() => {
    void data.planned;
    return null as string | null;
  });
  const pickedAnime = $derived(
    picked === null ? undefined : data.planned.find((anime) => plannedKey(anime) === picked)
  );
  const choices = $derived(shown.flatMap((one) => nextPart(one) ?? []));
  let pickPanel = $state<HTMLElement>();
  let pickButton = $state<HTMLButtonElement>();

  // From the toolbar, focus moves to the pick; "Pick another" keeps it on that button
  async function pickForMe(moveFocus: boolean) {
    const choice = pickAnother(choices, pickedAnime ?? null);
    if (!choice) return;
    picked = plannedKey(choice);
    if (!moveFocus) return;
    await tick();
    pickPanel?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion.current ? 'instant' : 'smooth',
    });
    pickPanel?.querySelector<HTMLElement>('.part-link')?.focus({ preventScroll: true });
  }

  /*
   * Keeps the pick's row as tall as the tallest pick it showed since it opened, so picking another
   * doesn't move the list below each time, as titles, English titles and genres take more or fewer
   * lines. At a new width it starts again from the pick it shows, as they wrap differently
   */
  let pickRow = $state<HTMLElement>();
  let windowWidth = $state(0);
  let tallestPick = { width: 0, height: 0 };
  $effect(() => {
    void pickedAnime;
    void windowWidth;
    if (!pickRow) {
      tallestPick = { width: 0, height: 0 };
      return;
    }
    pickRow.style.minHeight = '';
    const { offsetWidth: width, offsetHeight: height } = pickRow;
    tallestPick = {
      width,
      height: width === tallestPick.width ? Math.max(tallestPick.height, height) : height,
    };
    pickRow.style.minHeight = `${tallestPick.height}px`;
  });

  // Focus goes back to "Pick for me", or to the search when there's nothing left to pick
  async function closePick() {
    picked = null;
    await tick();
    if (pickButton && !pickButton.disabled) pickButton.focus();
    else filters?.focusSearch();
  }

  // What a failed save says in its row: the service's own reason, or that it didn't answer
  const failedMessage = (result: ActionResult) =>
    result.type === 'failure'
      ? String(result.data?.message ?? 'The update failed')
      : `${service} didn't answer, please try again`;

  // Whether a save came from this form's button: focus is still on it, or was lost as it was disabled
  const pressedIn = (form: HTMLFormElement) => {
    const focused = document.activeElement;
    return !focused || focused === document.body || form.contains(focused);
  };

  // Focus goes to what's there once the row has changed, without scrolling the page
  async function focusIn(within: Element | null, selector: string) {
    await tick();
    within?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  // An anime as the history of recent changes shows it
  const historyAnime = (anime: PlannedAnime) => ({
    ...(anime.id !== null && { mediaId: anime.id }),
    ...(anime.malId !== null && { malId: anime.malId }),
    title: anime.title,
    coverUrl: anime.coverUrl,
    isAdult: anime.isAdult,
  });

  function startWatching(anime: PlannedAnime): SubmitFunction {
    const key = plannedKey(anime);
    return ({ formElement }) => {
      const before = starts[key];
      const started = before?.started ?? false;
      // Only a start's own copy to the linked account is tried again by starting again
      const linked = started ? before?.linked : undefined;
      starts[key] = { saving: true, doing: 'start', started, linked };
      const part = formElement.closest('.part');
      return async ({ result }) => {
        const pressed = pressedIn(formElement);
        if (result.type === 'success') {
          const progress = Number(result.data?.progress ?? 0);
          // Starting again only tries the linked account again: the start is in the history already
          const changeId = started
            ? before?.changeId
            : (recordListChange(data.domain, data, {
                kind: 'move',
                anime: historyAnime(anime),
                before: { status: 'PLANNING' },
                after: { status: 'CURRENT', progress },
                // The linked account copied the start, so reverting it puts it back to Planning there
                linkedBefore: 'PLANNING',
              }) ?? undefined);
          // The button goes once the anime is started, so focus goes to the link in its place
          starts[key] = {
            saving: false,
            started: true,
            linked: result.data?.linked as LinkedFailure | undefined,
            changeId,
          };
          if (pressed) await focusIn(part, '.started a');
          // The watching list this tab remembers doesn't have it yet, nor do the friends pages
          noteListMove(
            {
              domain: data.domain,
              username: data.username,
              friendsViewer: data.domain === 'anilist' ? (data.user ?? null) : null,
            },
            // Plan lists have AniList's smallest covers; the friends pages show bigger posters
            {
              ...anime,
              coverUrl: anime.coverUrl?.replace('/cover/small/', '/cover/medium/') ?? null,
            },
            { list: 'CURRENT', progress }
          );
        } else {
          // As it was, so an Undo the linked account missed can still be tried again
          starts[key] = { ...before, saving: false, started, message: failedMessage(result) };
          if (pressed) await focusIn(formElement, 'button');
        }
      };
    };
  }

  /*
   * Takes an anime off the plan list, as Remove does, or puts it back, as Undo does, in its row.
   * Focus goes to the button that takes the pressed one's place. A removed anime leaves the plan
   * lists the tab remembers at once, as a started one does; one put back is read again with them
   */
  function removeOrUndo(anime: PlannedAnime, undo: boolean): SubmitFunction {
    const key = plannedKey(anime);
    return ({ formElement }) => {
      const before = starts[key];
      starts[key] = {
        ...before,
        saving: true,
        doing: undo ? 'undo' : 'remove',
        started: false,
        message: undefined,
      };
      const part = formElement.closest('.part');
      return async ({ result }) => {
        const pressed = pressedIn(formElement);
        if (result.type !== 'success') {
          starts[key] = {
            ...before,
            saving: false,
            started: false,
            message: failedMessage(result),
          };
          if (pressed) await focusIn(formElement, 'button');
          return;
        }
        if (undo) {
          // Back on the plan list; when the linked account missed it, that's said and tried again
          const linked = result.data?.linked as LinkedFailure | undefined;
          if (before?.changeId) forgetChange(before.changeId);
          starts[key] = linked
            ? { saving: false, started: false, linked, linkedRemoved: true }
            : { saving: false, started: false };
          forgetPlanned(data.domain, data.username);
        } else {
          // Trying again after the linked account missed it only changes that account
          const linkedRemoved = Boolean(result.data?.linkedRemoved || before?.linkedRemoved);
          // Removing again only tries the linked account again: the removal is in the history already
          const changeId = before?.removed
            ? before.changeId
            : (recordListChange(data.domain, data, {
                kind: 'remove',
                anime: historyAnime(anime),
                before: { status: 'PLANNING' },
                after: null,
                ...(linkedRemoved && { linkedRemoved: true }),
              }) ?? undefined);
          if (before?.removed && changeId && linkedRemoved) {
            updateChange(changeId, { linkedRemoved: true });
          }
          starts[key] = {
            saving: false,
            started: false,
            removed: true,
            linkedRemoved,
            linked: result.data?.linked as LinkedFailure | undefined,
            changeId,
          };
          markStarted(data.domain, data.username, anime);
        }
        if (pressed) await focusIn(part, undo ? 'button.remove' : 'button.undo');
      };
    };
  }

  // When it aired, how far along it is and how it's rated: "2025 · Airing · 12 episodes · 76% average"
  const facts = (anime: PlannedAnime) =>
    [
      anime.year,
      describePlanned(anime),
      anime.meanScore && `${formatMeanScore(anime.meanScore)} average`,
    ]
      .filter(Boolean)
      .join(' · ');

  const count = (total: number) => total.toLocaleString();
  const idFor = (key: string) => key.replaceAll(':', '-');
</script>

{#snippet startForm(anime: PlannedAnime, label: string)}
  {@const start = starts[plannedKey(anime)]}
  {@const busy = Boolean(start?.saving && start.doing === 'start')}
  <form
    class="start-form"
    method="POST"
    action="?/startWatching"
    use:enhance={startWatching(anime)}
  >
    {#if anime.id !== null}<input type="hidden" name="mediaId" value={anime.id} />{/if}
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <button
      class="tw:btn tw:btn-primary start"
      disabled={start?.saving}
      aria-busy={busy}
      aria-label={`${label}: ${anime.title}`}
    >
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}{label}{/if}
    </button>
  </form>
{/snippet}

<!--
  Remove, or Undo once it's removed, and each one's Try again when the linked account missed it:
  the button's words, then what it's called for screen readers
-->
{#snippet removeForm(anime: PlannedAnime, mode: 'remove' | 'retry-remove' | 'undo' | 'retry-undo')}
  {@const start = starts[plannedKey(anime)]}
  {@const undo = mode === 'undo' || mode === 'retry-undo'}
  {@const busy = Boolean(start?.saving && start.doing === (undo ? 'undo' : 'remove'))}
  {@const [label, name] = {
    remove: ['Remove', `Remove: ${anime.title}`],
    'retry-remove': ['Try again', `Try again to remove ${anime.title}`],
    undo: ['Undo', `Undo removing ${anime.title}`],
    'retry-undo': ['Try again', `Try again to put back ${anime.title}`],
  }[mode]}
  <form
    method="POST"
    action={undo ? '?/undoRemove' : '?/removeFromPlan'}
    use:enhance={removeOrUndo(anime, undo)}
  >
    {#if anime.id !== null}<input type="hidden" name="mediaId" value={anime.id} />{/if}
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    {#if undo && start?.linkedRemoved}<input type="hidden" name="linkedRemoved" value="true" />{/if}
    <button
      class={['tw:btn', mode === 'undo' ? 'undo' : 'tw:btn-ghost remove']}
      disabled={start?.saving}
      aria-busy={busy}
      aria-label={name}
    >
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}{label}{/if}
    </button>
  </form>
{/snippet}

<!--
  A sequel the page doesn't list, so it can't be started here: not planned, or not aired yet. The
  plan list's single read only gives its title and whether it's out
-->
{#snippet sequel(anime: PlannedSequel)}
  <div class="part">
    <a
      class="part-link"
      href={`https://anilist.co/anime/${anime.id}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span class="part-text">
        <span class="part-title">{anime.title}</span>
        <span class="part-facts">
          {describePlanned({ status: anime.status, episodes: null })} ·
          {anime.planned ? 'Planned' : 'Not planned'}
        </span>
        <span class="tw:sr-only">, opens in a new tab</span>
      </span>
    </a>
  </div>
{/snippet}

<!--
  One anime of a series: the first part in full, with its cover, and a later one by its title and
  facts alone, as the sequels the page doesn't list are beside it
-->
{#snippet part(anime: PlannedAnime, full: boolean)}
  {@const start = starts[plannedKey(anime)]}
  {@const english = full ? distinctEnglishTitle(anime) : null}
  <div class="part">
    <a
      class="part-link"
      href={animePageUrl(data.domain, anime)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {#if full}
        <span class="part-cover">
          <!-- A MyAnimeList list doesn't know AniList's id, which only tints the empty cover -->
          <SharedAnimePoster
            anime={{
              id: anime.id ?? anime.malId ?? 0,
              title: anime.title,
              isAdult: anime.isAdult,
              coverUrl: anime.coverUrl ?? undefined,
            }}
            compact
            decorative
            blurMature={data.preferences.blurMature}
          />
        </span>
      {/if}
      <span class="part-text">
        <span class="part-title">{anime.title}</span>
        {#if english}<span class="part-english">{english}</span>{/if}
        <span class="part-facts">{facts(anime)}</span>
        {#if full && anime.genres.length}
          <span class="part-genres">{anime.genres.join(' · ')}</span>
        {/if}
        <span class="tw:sr-only">, opens in a new tab</span>
      </span>
    </a>
    {#if data.canEdit}
      <!-- Start watching, once the earlier parts are, and Remove; or what became of it here -->
      <div class="part-action">
        {#if start?.started}
          <p class="started" role="status">
            <span aria-hidden="true">✓</span> Watching ·
            <a href={listUrl}>See your list</a>
          </p>
        {:else if start?.removed}
          <p class="started" role="status">
            <span aria-hidden="true">✓</span> Removed from your plan list
          </p>
          {@render removeForm(anime, 'undo')}
        {:else}
          {#if ready(anime)}{@render startForm(anime, 'Start watching')}{/if}
          {@render removeForm(anime, 'remove')}
        {/if}
      </div>
    {/if}
    {#if data.canEdit && (start?.linked || start?.message)}
      <!-- What went wrong, under the whole part, then its Try again button -->
      <div class="part-notes">
        {#if start?.linked}
          <p class="tw:text-error" role="alert">{start.linked.message}</p>
          {#if start.linked.retry}
            {#if start.removed}
              {@render removeForm(anime, 'retry-remove')}
            {:else if start.started}
              {@render startForm(anime, 'Try again')}
            {:else}
              <!-- Only Undo leaves the linked account to try again on an anime still planned -->
              {@render removeForm(anime, 'retry-undo')}
            {/if}
          {/if}
        {/if}
        {#if start?.message}
          <p class="tw:text-error" role="alert">{start.message}</p>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<svelte:window bind:innerWidth={windowWidth} />

<section class="planning-page">
  <header class="planning-header">
    <div class="heading-copy">
      <h1>{data.canEdit ? 'Your planning list' : `${data.username}'s planning list`}</h1>
      <p class="summary">
        {count(data.planned.length)} anime out now ·
        {#if data.upcoming}{count(data.upcoming)} not aired yet ·{/if}
        <a href={data.userProfileLink} target="_blank">See it on {service} ↗</a>
      </p>
    </div>
    <a class="tw:btn back-link" href={listUrl}
      ><span aria-hidden="true">←</span>
      {data.canEdit ? 'Your watching list' : `${data.username}'s list`}</a
    >
  </header>

  {#if data.planned.length === 0}
    <div class="empty-state">
      {#if data.upcoming}
        <h2>Nothing out yet</h2>
        <p>
          {data.upcoming === 1
            ? `The anime ${data.canEdit ? 'you' : data.username} planned hasn't aired yet.`
            : `The ${count(data.upcoming)} anime ${data.canEdit ? 'you' : data.username} planned haven't aired yet.`}
          {data.canEdit ? "They'll show up here once they do, ready to start." : ''}
        </p>
      {:else}
        <h2>Nothing planned yet</h2>
        <p>
          {data.canEdit
            ? `Add anime to your planning list on ${service}, and you can start them from here.`
            : `${data.username} hasn't planned any anime on ${service} yet.`}
        </p>
      {/if}
    </div>
  {:else}
    <ListFilters
      bind:this={filters}
      chips={filterChips}
      chipsLabel="Show only"
      onToggle={toggleFilter}
      bind:search
    >
      {#if genres.length}
        <select class="tw:select" aria-label="Genre" bind:value={genre}>
          <option value="">All genres</option>
          {#each genres as { genre: name, count: total } (name)}
            <option value={name}>{name} ({count(total)})</option>
          {/each}
        </select>
      {/if}
      <select class="tw:select" aria-label="Order" bind:value={sort}>
        {#each Object.entries(PLAN_SORTS) as [key, label] (key)}
          <option value={key}>{label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="tw:btn pick"
        disabled={!choices.length}
        bind:this={pickButton}
        onclick={() => pickForMe(true)}
      >
        Pick for me
      </button>
    </ListFilters>
    {#if pickedAnime}
      <section class="pick-panel" aria-labelledby="pick-heading" bind:this={pickPanel}>
        <header class="pick-header">
          <h2 id="pick-heading">Picked for you</h2>
          <button
            type="button"
            class="tw:btn tw:btn-ghost pick-another"
            disabled={!choices.some((choice) => choice !== pickedAnime)}
            onclick={() => pickForMe(false)}
          >
            Pick another
          </button>
          <CloseButton label="Close the pick" onclick={closePick} />
        </header>
        <div class="pick-row" bind:this={pickRow}>
          <!-- Built again for each pick, as its forms are set up once for the anime they're for -->
          {#key picked}{@render part(pickedAnime, true)}{/key}
        </div>
      </section>
    {/if}
    <!-- Tells screen readers how many anime match as the viewer narrows the list, which changes silently -->
    <p class="tw:sr-only" aria-live="polite">
      {narrowed ? `${count(shownCount)} ${shownCount === 1 ? 'anime matches' : 'anime match'}` : ''}
    </p>

    {#if shown.length === 0}
      <div class="empty-state">
        <h2>No matching anime</h2>
        <p>Try another title or fewer filters, or clear them to see the whole list.</p>
        <button type="button" class="tw:btn" onclick={clearFilters}>Clear search and filters</button
        >
      </div>
    {:else}
      <ul class="plan-list" bind:this={rows}>
        {#each shown.slice(0, limit) as one (seriesKey(one))}
          {@const key = seriesKey(one)}
          {@const steps = seriesSteps(one)}
          <li class="series">
            {@render part(one.parts[0], true)}
            {#if steps.length}
              <div class="later">
                <p class="later-label" id={`later-${idFor(key)}`}>Next in this series</p>
                <ol aria-labelledby={`later-${idFor(key)}`}>
                  {#each steps as step (step.kind === 'part' ? plannedKey(step.anime) : step.anime.id)}
                    <li>
                      {#if step.kind === 'part'}
                        {@render part(step.anime, false)}
                      {:else}
                        {@render sequel(step.anime)}
                      {/if}
                    </li>
                  {/each}
                </ol>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if shown.length > limit}
        <div class="more">
          <button type="button" class="tw:btn" onclick={showMore}>
            Show more <span class="more-count">{count(shown.length - limit)} left</span>
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .planning-page {
    /* A row's inset, cover and the gap after it, which the later parts of a series line up with */
    --row-inset: 16px;
    --cover-width: 56px;
    --cover-gap: 14px;
    width: 100%;
    max-width: 70rem;
    margin: 24px auto 0;
  }

  /* A long name wraps the back link onto its own line rather than squeezing either */
  .planning-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 24px;
    margin-bottom: 22px;
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

  .summary a:hover,
  .summary a:focus-visible,
  .started a:hover,
  .started a:focus-visible {
    text-decoration: underline;
  }

  .back-link {
    flex: none;
    min-height: 44px;
  }

  .pick {
    min-height: 40px;
    font-size: 0.85rem;
  }

  /* One panel, a series to a row, so the list reads down a single column */
  .plan-list {
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .series {
    container: plan-row / inline-size;
  }

  .series + .series {
    border-top: 1px solid var(--border-subtle);
  }

  /* The anime, the whole of it a link, beside its button */
  .part {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px 16px;
    padding: 12px var(--row-inset);
    transition: background-color 150ms ease;
  }

  .part:has(.part-link:hover) {
    background: var(--you-blue-pale);
  }

  /* The pick is a selection, so it's outlined in blue, and named by its heading */
  .pick-panel {
    container: plan-row / inline-size;
    margin-bottom: 16px;
    border: 1px solid var(--you-blue);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .pick-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 0 16px;
  }

  .pick-header h2 {
    flex: 1;
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .pick-another {
    min-height: 44px;
    font-size: 0.85rem;
  }

  /* The row fills the height kept for the tallest pick, its anime and button centered in it */
  .pick-row {
    display: grid;
  }

  .pick-panel .part {
    align-content: center;
    border-radius: 0 0 var(--radius-panel) var(--radius-panel);
  }

  .part-link {
    display: flex;
    align-items: center;
    gap: var(--cover-gap);
    min-width: 0;
    border-radius: var(--radius-control);
  }

  .part-cover {
    flex: none;
    width: var(--cover-width);
  }

  .part-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .part-title {
    color: var(--text-heading);
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .part-english {
    color: var(--text-accent);
    font-size: 0.8125rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .part-facts {
    margin-top: 2px;
    color: var(--text-heading);
    font-size: 0.8rem;
  }

  .part-genres {
    color: var(--text-accent);
    font-size: 0.75rem;
  }

  /* Start watching, then Remove, at the end of the row; or what became of the anime, then Undo */
  .part-action {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Quieter than Start watching, and as easy to reach */
  .remove,
  .undo {
    min-height: 44px;
    font-size: 0.85rem;
  }

  /* As wide for "Try again" as for "Start watching", so the buttons line up down the list */
  .start {
    min-width: 9.75em;
    min-height: 44px;
    font-size: 0.85rem;
  }

  .started {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 600;
  }

  /* As tall as the button it replaces, so it's as easy to reach */
  .started a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--you-blue);
  }

  .part-notes {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  /* The later parts, lined up with the first part's text, on a quieter surface */
  .later {
    overflow: hidden;
    margin: -4px var(--row-inset) 14px
      calc(var(--row-inset) + var(--cover-width) + var(--cover-gap));
    border-radius: var(--radius-control);
    background: var(--surface-muted);
  }

  .later-label {
    padding: 8px 12px 0;
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .later .part {
    padding: 8px 12px;
  }

  .later li + li {
    border-top: 1px solid var(--border-subtle);
  }

  .later .part-title {
    font-size: 0.875rem;
  }

  /* On a narrow row the buttons go under the anime, Start watching across the row beside Remove */
  @container plan-row (max-width: 34rem) {
    .part {
      grid-template-columns: minmax(0, 1fr);
    }

    .part-action {
      justify-content: flex-start;
    }

    .start-form,
    .started {
      flex: 1;
    }

    .start {
      width: 100%;
    }

    .started {
      justify-content: center;
    }

    .later {
      margin-left: var(--row-inset);
    }
  }

  .more {
    display: flex;
    justify-content: center;
    margin-top: 32px;
  }

  .more button {
    min-height: 44px;
    padding-inline: 16px;
  }

  .more-count {
    color: var(--text-accent);
    font-weight: 500;
  }

  .empty-state {
    max-width: 36rem;
    margin: 24px auto;
    padding: 32px 16px;
    color: var(--text-accent);
    text-align: center;
  }

  .empty-state h2 {
    margin-bottom: 8px;
    color: var(--text-heading);
    font-size: 1.125rem;
    font-weight: 600;
  }

  .empty-state button {
    min-height: 44px;
    margin-top: 20px;
    padding-inline: 16px;
  }

  @media (pointer: coarse) {
    .pick {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .part {
      transition: none;
    }
  }
</style>

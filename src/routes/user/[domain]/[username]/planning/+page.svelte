<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { tick } from 'svelte';

  import { matchesSearch, searchIndex, searchWords } from '#lib/anime.js';
  import AnimeRow from '#lib/components/AnimeRow.svelte';
  import ListFilters from '#lib/components/ListFilters.svelte';
  import { recordOwnWatchingEntry } from '#lib/friend-watching.js';
  import { expireRememberedList } from '#lib/list-data.js';
  import { describePlanned, distinctEnglishTitle, markStarted, plannedKey } from '#lib/planning.js';
  import { formatMeanScore } from '#lib/score.js';
  import type { PlannedAnime } from '#lib/types/anime.js';
  import type { LinkedFailure } from '#lib/types/api.js';
  import { DOMAIN_NAMES, listPath } from '#lib/types/domain.js';

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
  const shown = $derived(
    words.length
      ? data.planned.filter((anime) => matchesSearch(searchIndexes.get(plannedKey(anime))!, words))
      : data.planned
  );

  /*
   * Rows are added a batch at a time, as a plan list can be over a thousand long and every row slows
   * down opening the page and searching it. A new list or search starts with the first batch
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
   * What happened to each anime the viewer started watching here. The answer updates its card, and
   * the plan list isn't read again: the anime leaves it on the next visit. A started anime whose
   * copy to the linked account failed stays started while that's tried again
   */
  let starts = $state<
    Record<
      string,
      { saving: boolean; started: boolean; linked?: LinkedFailure; message?: string } | undefined
    >
  >({});
  $effect(() => {
    void data.planned;
    starts = {};
  });

  function startWatching(anime: PlannedAnime): SubmitFunction {
    const key = plannedKey(anime);
    return ({ formElement }) => {
      const started = starts[key]?.started ?? false;
      starts[key] = { saving: true, started, linked: starts[key]?.linked };
      const row = formElement.closest('li');
      return async ({ result }) => {
        if (result.type === 'success') {
          /*
           * The button goes once the anime is started, so its focus, or the focus disabling it lost,
           * goes to the link that takes its place, without scrolling the page
           */
          const focused = document.activeElement;
          const pressed = !focused || focused === document.body || formElement.contains(focused);
          starts[key] = {
            saving: false,
            started: true,
            linked: result.data?.linked as LinkedFailure | undefined,
          };
          if (pressed) {
            await tick();
            row?.querySelector<HTMLElement>('.started a')?.focus({ preventScroll: true });
          }
          markStarted(data.domain, data.username, anime);
          // The watching list this tab remembers doesn't have it yet, nor do the friends pages
          expireRememberedList(data.username, data.domain);
          if (data.domain === 'anilist' && data.user && anime.id !== null) {
            recordOwnWatchingEntry(
              data.user,
              {
                id: anime.id,
                title: anime.title,
                isAdult: anime.isAdult,
                // Plan lists have AniList's smallest covers; the friends pages show bigger posters
                thumbnailUrl: anime.coverUrl?.replace('/cover/small/', '/cover/medium/') ?? '',
                currentEpisode: Number(result.data?.progress ?? 0),
                rewatching: false,
              },
              'CURRENT'
            );
          }
        } else {
          starts[key] = {
            saving: false,
            started,
            linked: starts[key]?.linked,
            message:
              result.type === 'failure'
                ? String(result.data?.message ?? 'The update failed')
                : `${service} didn't answer, please try again`,
          };
        }
      };
    };
  }

  // Lists link to anime on their own service, as the watching list does
  const animeLink = (anime: PlannedAnime) =>
    data.domain === 'myanimelist' && anime.malId !== null
      ? `https://myanimelist.net/anime/${anime.malId}`
      : `https://anilist.co/anime/${anime.id}`;

  const count = (total: number) => total.toLocaleString();
</script>

{#snippet startForm(anime: PlannedAnime, label: string)}
  {@const saving = starts[plannedKey(anime)]?.saving ?? false}
  <form method="POST" action="?/startWatching" use:enhance={startWatching(anime)}>
    {#if anime.id !== null}<input type="hidden" name="mediaId" value={anime.id} />{/if}
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <button
      class="tw:btn tw:btn-primary start"
      disabled={saving}
      aria-busy={saving}
      aria-label={`${label}: ${anime.title}`}
    >
      {#if saving}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}{label}{/if}
    </button>
  </form>
{/snippet}

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
    <ListFilters bind:this={filters} bind:search />
    <!-- Tells screen readers how many anime match as the viewer types, as the grid changes silently -->
    <p class="tw:sr-only" aria-live="polite">
      {words.length ? `${shown.length} anime ${shown.length === 1 ? 'matches' : 'match'}` : ''}
    </p>

    {#if shown.length === 0}
      <div class="empty-state">
        <h2>No matching anime</h2>
        <p>Try another title, or clear your search to see the whole list.</p>
        <button
          type="button"
          class="tw:btn"
          onclick={() => {
            search = '';
            filters?.focusSearch();
          }}>Clear search</button
        >
      </div>
    {:else}
      <ul class="planned-rows" bind:this={rows}>
        {#each shown.slice(0, limit) as anime (plannedKey(anime))}
          {@const start = starts[plannedKey(anime)]}
          {@const english = distinctEnglishTitle(anime)}
          {#snippet details()}
            {#if english}<span class="row-english">{english}</span>{/if}
            <span class="row-details">
              {describePlanned(anime)}{anime.meanScore
                ? ` · ${formatMeanScore(anime.meanScore)} average`
                : ''}
            </span>
          {/snippet}
          {#snippet action()}
            {#if start?.started}
              <p class="started" role="status">
                <span aria-hidden="true">✓</span> Watching ·
                <a href={listUrl}>See your list</a>
              </p>
            {:else}
              {@render startForm(anime, 'Start watching')}
            {/if}
          {/snippet}
          {#snippet notes()}
            <div class="notes">
              {#if start?.started && start.linked}
                <p class="tw:text-error" role="alert">{start.linked.message}</p>
                {#if start.linked.retry}{@render startForm(anime, 'Try again')}{/if}
              {/if}
              {#if start?.message}
                <p class="tw:text-error" role="alert">{start.message}</p>
              {/if}
            </div>
          {/snippet}
          <li>
            <!-- A MyAnimeList list doesn't know AniList's id, which only tints the empty cover -->
            <AnimeRow
              anime={{
                id: anime.id ?? anime.malId ?? 0,
                title: anime.title,
                isAdult: anime.isAdult,
                coverUrl: anime.coverUrl ?? undefined,
              }}
              href={animeLink(anime)}
              blurMature={data.preferences.blurMature}
              {details}
              action={data.canEdit ? action : undefined}
              notes={data.canEdit && ((start?.started && start.linked) || start?.message)
                ? notes
                : undefined}
            />
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

  /* Rows side by side where there's room for two, one under the other below that */
  .planned-rows {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 30rem), 1fr));
    gap: 10px 16px;
  }

  .row-english {
    color: var(--text-accent);
    font-size: 0.8125rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .row-details {
    margin-top: 2px;
    color: var(--text-accent);
    font-size: 0.75rem;
  }

  .start {
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

  /* What went wrong, under the whole row, then its Try again button */
  .notes {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  /* On a narrow row the action goes under the anime, across the row */
  @container anime-row (max-width: 26rem) {
    .start {
      width: 100%;
    }

    .started {
      justify-content: center;
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
</style>

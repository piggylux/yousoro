<script lang="ts">
  import { untrack } from 'svelte';

  import CloseButton from '#lib/components/CloseButton.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import {
    nyaaNarrowing,
    nyaaSearchUrl,
    nyaaSite,
    nyaaQueryLength,
    NYAA_MAX_QUERY_LENGTH,
    NYAA_CLIENT_TIMEOUT_MS,
    type NyaaSearch,
  } from '#lib/nyaa.js';

  // How long a step waits for another before searching
  const STEP_DELAY_MS = 300;

  let {
    search,
    episodes,
    onclose,
  }: {
    search: NyaaSearch;
    /** The episodes the viewer can step through, as the ones they're behind on */
    episodes?: { first: number; last: number };
    onclose: () => void;
  } = $props();
  const heading = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let results = $state<HTMLElement>();
  let queryInput = $state<HTMLInputElement>();
  let filterInput = $state<HTMLInputElement>();
  let loading = $state(true);
  let errorMessage = $state('');
  let attempt = $state(0);
  // The episode searched, from the one the dialog opened on, as the viewer steps through `episodes`
  let episode = $state(untrack(() => search.episode));
  const first = $derived(episodes?.first ?? search.episode);
  const last = $derived(episodes?.last ?? search.episode);
  // A step waits for the viewer to stop clicking, so the episodes passed on aren't searched
  let stepped = false;
  const suggestedQuery = $derived(`${search.title} ${String(episode).padStart(2, '0')}`);
  let queryDraft = $derived(suggestedQuery);
  const queryTooLong = $derived(nyaaQueryLength(queryDraft.trim()) > NYAA_MAX_QUERY_LENGTH);
  let appliedQuery = $state<string | null>(null);
  let resolvedQuery = $state<string | null>(null);
  // Every release, past what the viewer's settings keep the search to, for this dialog only
  let allReleases = $state(false);
  // No release had the episode alone, so these are packs that include it
  let inPacks = $state(false);
  const scopedSearch = $derived<NyaaSearch>({
    ...search,
    episode,
    ...(allReleases ? { language: 'any', version: 'any' } : {}),
  });
  const activeSearch = $derived(
    appliedQuery === null ? scopedSearch : { ...scopedSearch, query: appliedQuery }
  );
  // What the viewer's settings keep the search to, as in "French dubbed". The dialog says so, or
  // finding none of those would read as there being no release at all
  const narrowing = $derived(
    nyaaNarrowing(appliedQuery === null ? search : { ...search, query: appliedQuery })
  );
  const lookingFor = $derived(allReleases ? '' : narrowing);
  // The width of each placeholder release's title, varied so they read as titles
  const SKELETON_TITLES = ['88%', '72%', '94%', '64%', '80%'];

  const searchingText = $derived(
    lookingFor ? `Searching for ${lookingFor} releases…` : 'Searching for releases…'
  );
  const emptyText = $derived(
    lookingFor
      ? `No ${lookingFor} releases found. Show all releases, or try another search query.`
      : 'No releases found. Try another search query.'
  );
  const resultSearch = $derived(
    resolvedQuery === null ? activeSearch : { ...activeSearch, query: resolvedQuery }
  );
  type Release = {
    id: string;
    title: string;
    size: string;
    seeders: string;
    leechers: string;
    date: string;
    magnet: string;
  };
  let releases = $state<Release[]>([]);
  let filter = $state('');
  const filteredReleases = $derived.by(() => {
    const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return releases.filter((release) =>
      terms.every((term) => release.title.toLowerCase().includes(term))
    );
  });
  const site = $derived(nyaaSite(search.adult ?? false));
  // Packs when no release had the episode alone, in the count as in what a screen reader hears
  const releaseNoun = (count: number) => `${inPacks ? 'pack' : 'release'}${count === 1 ? '' : 's'}`;
  /*
   * What a screen reader hears about the list: as each search starts and ends, and how many
   * releases match as the viewer filters them, including with a filter kept from the episode
   * before. The list's own messages appear with their text, which screen readers mostly don't read
   * out, so this region is always there and only its text changes. It's the only one, so nothing
   * is read twice. A failure is read out by its alert
   */
  const announcement = $derived.by(() => {
    if (loading) return searchingText;
    if (errorMessage) return '';
    const count = releases.length;
    if (!count) return emptyText;
    const packs = inPacks ? `No release of episode ${episode} alone. ` : '';
    if (filter.trim()) {
      const shown = filteredReleases.length;
      const matching =
        shown === 0
          ? count === 1
            ? `The ${releaseNoun(1)} doesn't match`
            : `None of the ${count} ${releaseNoun(count)} match`
          : `${shown} of ${count} ${releaseNoun(count)} ${shown === 1 ? 'matches' : 'match'}`;
      return `${packs}${matching} your filter`;
    }
    return inPacks
      ? `${packs}${count} ${count === 1 ? 'pack includes' : 'packs include'} it`
      : `${count} ${releaseNoun(count)} found`;
  });

  $effect(() => {
    void filter;
    void episode;
    if (results) results.scrollTop = 0;
  });
  $effect(() => {
    dialog?.showModal();
  });
  $effect(() => {
    void attempt;
    const selection = activeSearch;
    const controller = new AbortController();
    loading = true;
    errorMessage = '';
    resolvedQuery = null;
    inPacks = false;
    releases = [];
    async function load() {
      // From when the search starts, so the wait after a step doesn't count
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(NYAA_CLIENT_TIMEOUT_MS),
      ]);
      try {
        const response = await fetch('/api/nyaa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selection),
          signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 429
              ? 'Too many searches. Please wait before trying again.'
              : response.status === 504
                ? 'Nyaa search timed out. Try a shorter query or open the search on Nyaa.'
                : response.status === 400
                  ? 'Search query is too long or invalid. Use fewer title words or alternatives.'
                  : 'Nyaa results are unavailable. Try again or open the search on Nyaa.'
          );
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (
          xml.querySelector('parsererror') ||
          xml.documentElement.localName !== 'rss' ||
          !xml.querySelector('channel')
        )
          throw new Error(
            'Nyaa returned an unreadable feed. Try again or open the search on Nyaa.'
          );
        const rows = Array.from(xml.querySelectorAll('item')).flatMap((item) => {
          const text = (name: string) =>
            Array.from(item.children)
              .find((node) => node.localName === name)
              ?.textContent?.trim() ?? '';
          // Ignore description HTML and construct all outgoing links from validated IDs/hashes.
          const id = text('guid').match(
            new RegExp(
              `^https://${nyaaSite(selection.adult ?? false).replaceAll('.', '\\.')}/view/(\\d+)$`
            )
          )?.[1];
          if (!id || !text('title')) return [];
          const hash = text('infoHash');
          const magnet = /^[a-f0-9]{40}$/i.test(hash)
            ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(text('title'))}`
            : '';
          const date = new Date(text('pubDate'));
          return [
            {
              id,
              title: text('title'),
              size: text('size'),
              seeders: text('seeders'),
              leechers: text('leechers'),
              date: Number.isNaN(date.getTime())
                ? ''
                : date.toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }),
              magnet,
            },
          ];
        });
        if (!controller.signal.aborted) {
          releases = rows;
          const query = response.headers.get('X-Nyaa-Query');
          resolvedQuery = query ? decodeURIComponent(query) : null;
          inPacks = response.headers.get('X-Nyaa-Packs') === '1';
        }
      } catch (err) {
        if (!controller.signal.aborted)
          errorMessage = signal.aborted
            ? 'Nyaa search timed out. Try a shorter query or open the search on Nyaa.'
            : err instanceof Error
              ? err.message
              : 'Could not load Nyaa results.';
      } finally {
        if (!controller.signal.aborted) loading = false;
      }
    }
    // After a step, only once the viewer stops clicking through episodes
    const delayed = stepped;
    stepped = false;
    const timer = delayed ? setTimeout(() => void load(), STEP_DELAY_MS) : undefined;
    if (!delayed) void load();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  function step(to: number) {
    if (to < first || to > last || to === episode) return;
    stepped = true;
    episode = to;
    // A custom search was for the episode before
    appliedQuery = null;
  }
</script>

<dialog
  bind:this={dialog}
  use:closeOnBackdrop
  aria-labelledby={heading}
  aria-describedby={`${heading}-description`}
  {onclose}
>
  <header>
    <div class="heading-copy">
      <p class="eyebrow">Releases from {site}</p>
      <h2 id={heading}>{search.title}</h2>
      <p class="description" id={`${heading}-description`}>
        {appliedQuery === null ? `Episode ${episode}` : 'Custom search'} ·
        <a href={nyaaSearchUrl(resultSearch)} target="_blank" rel="noreferrer"
          >Open full search ↗<span class="tw:sr-only"> (opens in a new tab)</span></a
        >
      </p>
    </div>
    <CloseButton label="Close Nyaa results" onclick={() => dialog?.close()} />
  </header>
  <!-- Outside the body, so it stays in view when the body scrolls on a short screen. The ends are
  aria-disabled rather than disabled, so focus stays on the button that reached one -->
  {#if last > first}
    <div class="episode-stepper" role="group" aria-label="Episodes to watch">
      <button
        type="button"
        class="step"
        aria-label={episode > first ? `Previous episode, ${episode - 1}` : 'Previous episode'}
        aria-disabled={episode <= first}
        onclick={() => step(episode - 1)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg
        >
      </button>
      <p>
        <strong aria-live="polite">Episode {episode}</strong>
        <span>{first}–{last} to watch</span>
      </p>
      <button
        type="button"
        class="step"
        aria-label={episode < last ? `Next episode, ${episode + 1}` : 'Next episode'}
        aria-disabled={episode >= last}
        onclick={() => step(episode + 1)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
        >
      </button>
    </div>
  {/if}
  <div class="dialog-body">
    <form
      class="search-form"
      onsubmit={(event) => {
        event.preventDefault();
        const query = queryDraft.trim();
        if (!query || queryTooLong) return;
        appliedQuery = query;
        filter = '';
        attempt++;
      }}
    >
      <label class="tw:sr-only" for={`${heading}-query`}>Search Nyaa</label>
      <div class="search-row">
        <input
          id={`${heading}-query`}
          bind:this={queryInput}
          type="search"
          bind:value={queryDraft}
          maxlength="500"
          required
          placeholder="Title, episode or release group…"
          aria-controls={`${heading}-results`}
          aria-invalid={queryTooLong || undefined}
          aria-describedby={queryTooLong ? `${heading}-query-length` : undefined}
        />
        <button class="search-submit" type="submit" disabled={!queryDraft.trim() || queryTooLong}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
            ><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg
          >
          Search
        </button>
      </div>
      <!-- Always there, out of sight and taking no room while empty, so a screen reader reads the
      warning as it appears -->
      <p id={`${heading}-query-length`} class={[!queryTooLong && 'tw:sr-only']} role="status">
        {queryTooLong ? 'This search is too long. Use fewer title words or alternatives.' : ''}
      </p>
      <!-- Reset waits for a custom search to run, so typing doesn't push the results down -->
      {#if narrowing || appliedQuery !== null}
        <div class="search-options">
          {#if narrowing}
            <p>
              {allReleases
                ? 'Showing all releases.'
                : `Only ${narrowing} releases, per your settings.`}
              <button
                class="text-button"
                type="button"
                onclick={() => {
                  allReleases = !allReleases;
                  filter = '';
                }}>{allReleases ? `Only ${narrowing}` : 'Show all releases'}</button
              >
            </p>
          {/if}
          {#if appliedQuery !== null}
            <button
              class="text-button"
              type="button"
              aria-label="Reset to automatic episode search"
              onclick={() => {
                appliedQuery = null;
                queryDraft = suggestedQuery;
                filter = '';
                attempt++;
                queryInput?.focus();
              }}>Reset search</button
            >
          {/if}
        </div>
      {/if}
    </form>
    <!-- Only shown once there are releases to filter, but its room is kept while a search loads,
    so the list doesn't jump when they arrive; not for a failed or empty search -->
    {#if !errorMessage && (loading || releases.length > 0)}
      <div class="filter" class:waiting={loading}>
        <label class="tw:sr-only" for={`${heading}-filter`}>Filter loaded results</label>
        <div class="filter-input">
          <svg
            class="filter-icon"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z" /></svg
          >
          <input
            id={`${heading}-filter`}
            bind:this={filterInput}
            type="search"
            bind:value={filter}
            placeholder="Filter these results…"
            aria-controls={`${heading}-results`}
          />
          {#if filter}
            <button
              type="button"
              class="clear-filter"
              aria-label="Clear filter"
              onclick={() => {
                filter = '';
                filterInput?.focus();
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg
              >
            </button>
          {/if}
        </div>
        <!-- Kept while hidden too, as on a narrow screen it takes a line of its own. Read out by the
        list's status at the end of the dialog -->
        <p class="result-count">
          {filteredReleases.length} of {releases.length}
          {releaseNoun(releases.length)}
        </p>
      </div>
    {/if}
    <section
      bind:this={results}
      id={`${heading}-results`}
      aria-label="Nyaa releases"
      aria-busy={loading}
    >
      {#if loading}
        <!-- Releases in outline while the search runs; the status below says what it's looking for -->
        <div class="skeleton" aria-hidden="true">
          <!-- Where the line saying how the releases are ordered goes -->
          <span class="skeleton-order"><Skeleton width="13rem" /></span>
          <ul>
            {#each SKELETON_TITLES as width, index (index)}
              <li>
                <Skeleton {width} height="0.85rem" />
                <span class="skeleton-metadata"><Skeleton width="9rem" height="0.7rem" /></span>
                <span class="release-actions">
                  <span class="swarm-stats">
                    <Skeleton width="64px" height="44px" />
                    <Skeleton width="64px" height="44px" />
                  </span>
                  <span class="downloads">
                    <Skeleton width="6rem" height="38px" />
                    <Skeleton width="6rem" height="38px" />
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {:else if errorMessage}
        <div class="message">
          <p role="alert">{errorMessage}</p>
          <button class="retry" type="button" onclick={() => attempt++}>Try again</button>
        </div>
      {:else if releases.length === 0}
        <p class="message">{emptyText}</p>
      {:else}
        <p class="result-order">
          {inPacks
            ? `No release of episode ${episode} alone · Packs that include it`
            : 'Newest first · Latest RSS results'}
        </p>
        {#if filteredReleases.length === 0}
          <p class="message">
            No releases match your filter. Try different words or clear the filter.
          </p>
        {/if}
        <ul>
          {#each filteredReleases as release}
            <li>
              <a
                class="release-title"
                href={`https://${site}/view/${release.id}`}
                target="_blank"
                rel="noreferrer"
                >{release.title}<span class="tw:sr-only"> (opens in a new tab)</span></a
              >
              <p class="metadata">
                {release.size}{release.date ? ` · ${release.date}` : ''}
              </p>
              <div class="release-actions">
                <div class="swarm-stats">
                  <span class="stat seeders">
                    <strong>{release.seeders || '—'}</strong>
                    <span>Seeders</span>
                  </span>
                  <span class="stat leechers">
                    <strong>{release.leechers || '—'}</strong>
                    <span>Leechers</span>
                  </span>
                </div>
                <div class="downloads">
                  {#if release.magnet}<a href={release.magnet}>Magnet</a>{/if}
                  <a href={`https://${site}/download/${release.id}.torrent`} rel="noreferrer"
                    >Torrent</a
                  >
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <p class="tw:sr-only" role="status">{announcement}</p>
  </div>
</dialog>

<style>
  /*
   * A steady height, as every search empties the list until its releases arrive, and a centered
   * dialog that shrank and grew would move its controls, like the stepper, from under the pointer.
   * Only the list area changes
   */
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 42rem);
    height: min(85dvh, 44rem);
    max-height: 85dvh;
    padding: var(--dialog-padding);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  .dialog-body {
    display: contents;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex: none;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-heading);
    letter-spacing: normal;
    overflow-wrap: anywhere;
  }
  .eyebrow {
    font-size: 0.75rem;
    letter-spacing: normal;
    text-transform: none;
    font-weight: 600;
    color: var(--text-accent);
    margin-bottom: 3px;
  }
  .description {
    margin-top: 4px;
    font-size: 0.75rem;
    opacity: 0.65;
  }
  .episode-stepper {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .episode-stepper p {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    column-gap: 8px;
    text-align: center;
  }
  .episode-stepper strong {
    font-size: 0.9rem;
    font-weight: 650;
    color: var(--text-heading);
    font-variant-numeric: tabular-nums;
  }
  .episode-stepper span {
    font-size: 0.75rem;
    opacity: 0.65;
  }
  .step {
    flex: none;
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--you-blue-pale);
    color: var(--text-accent);
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }
  .step:not([aria-disabled='true']):hover {
    background: var(--sea-blue);
    border-color: var(--sea-blue);
    color: #ffffff;
  }
  .step[aria-disabled='true'] {
    opacity: 0.45;
    cursor: default;
  }
  a {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button {
    cursor: pointer;
  }
  .search-form {
    flex: none;
    display: grid;
    gap: 8px;
  }
  .search-form p {
    color: var(--text-accent);
    font-size: 0.8125rem;
  }
  .search-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  /* What the search keeps to, and the way back to the automatic search */
  .search-options {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    column-gap: 12px;
  }
  .search-options > .text-button {
    margin-left: auto;
  }
  .filter {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }
  /* Out of sight, out of the tab order and unread, but keeping its room */
  .filter.waiting {
    visibility: hidden;
  }
  .filter-input {
    position: relative;
    flex: 1 1 12rem;
    min-width: 0;
  }
  .filter input,
  .search-form input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--color-base-content);
    font-size: 0.8rem;
  }
  .filter input {
    padding-inline: 38px 40px;
  }
  .filter input::-webkit-search-cancel-button {
    display: none;
  }
  .filter-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-accent);
    pointer-events: none;
  }
  .clear-filter {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-accent);
    border-radius: 8px;
  }
  .search-submit:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .text-button {
    padding: 4px 0;
    background: transparent;
    border: 0;
    color: var(--text-accent);
    font-size: 0.8125rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  a:focus-visible,
  input:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  section {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 3px 5px 8px;
    scrollbar-width: thin;
  }
  .message {
    padding: 24px 0;
    text-align: center;
    font-size: 0.8rem;
    opacity: 0.65;
  }
  .retry,
  .downloads a {
    display: inline-block;
    padding: 9px 18px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 650;
    text-decoration: none;
  }
  .search-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 14px;
    min-height: 44px;
    border: 1px solid var(--sea-blue);
    border-radius: var(--radius-control);
    background: var(--sea-blue);
    color: #ffffff;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .search-submit svg {
    flex: none;
  }
  .retry {
    margin-top: 16px;
  }
  .downloads a {
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }
  .downloads a:hover {
    background: var(--sea-blue);
    border-color: var(--sea-blue);
    color: #ffffff;
  }
  .search-submit:not(:disabled):hover {
    background: var(--navy);
    border-color: var(--navy);
  }
  .clear-filter:hover {
    background: var(--surface);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    padding: 12px 8px;
  }
  li + li {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }
  /* As many placeholder releases as fit, without making the list scroll while it loads */
  .skeleton {
    height: 100%;
    overflow: hidden;
  }
  .skeleton-order {
    display: block;
    margin-bottom: 12px;
    padding: 3px 0;
  }
  .skeleton-metadata {
    display: block;
    margin: 10px 0;
  }
  .release-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-heading);
    overflow-wrap: anywhere;
  }
  .metadata {
    margin: 8px 0;
    font-size: 0.68rem;
    color: var(--text-accent);
    opacity: 0.7;
  }
  .result-count,
  .result-order {
    font-size: 0.75rem;
    opacity: 0.6;
  }
  .result-count {
    flex: none;
  }
  .result-order {
    margin-bottom: 12px;
  }
  .release-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .downloads,
  .swarm-stats {
    display: flex;
    gap: 8px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 64px;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
  }
  .seeders {
    background: light-dark(#e9f6ee, #16382c);
    color: light-dark(#206541, #8bdeb0);
  }
  .stat strong {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .stat > span {
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: normal;
    text-transform: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .downloads a,
    .step {
      transition: none;
    }
  }
  @media (max-width: 480px) {
    .search-form input,
    .filter input {
      font-size: 1rem;
    }
    .search-submit {
      padding-inline: 12px;
    }
  }
  @media (pointer: coarse) {
    .text-button {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
  }
  @media (max-height: 600px) {
    dialog {
      height: calc(100dvh - 24px);
      max-height: calc(100dvh - 24px);
    }
    .dialog-body {
      display: block;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .dialog-body > * + * {
      margin-top: 16px;
    }
    section {
      max-height: 50dvh;
    }
    /* The list has no set height here, so the skeleton stops at the most it shows, less its padding */
    .skeleton {
      height: auto;
      max-height: calc(50dvh - 3px - 8px);
    }
  }
</style>

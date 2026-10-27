<script lang="ts">
  import { closeOnBackdrop } from '#lib/dialog.js';
  import { nyaaSearchUrl, nyaaSite, type NyaaSearch } from '#lib/nyaa.js';

  let { search, onclose }: { search: NyaaSearch; onclose: () => void } = $props();
  const heading = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let results = $state<HTMLElement>();
  let queryInput = $state<HTMLInputElement>();
  let filterInput = $state<HTMLInputElement>();
  let loading = $state(true);
  let errorMessage = $state('');
  let attempt = $state(0);
  const suggestedQuery = $derived(`${search.title} ${String(search.episode).padStart(2, '0')}`);
  let queryDraft = $derived(suggestedQuery);
  let appliedQuery = $state<string | null>(null);
  const activeSearch = $derived(
    appliedQuery === null ? search : { ...search, query: appliedQuery }
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

  $effect(() => {
    void filter;
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
    releases = [];
    async function load() {
      try {
        const response = await fetch('/api/nyaa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selection),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 429
              ? 'Too many searches. Please wait before trying again.'
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
        if (!controller.signal.aborted) releases = rows;
      } catch (err) {
        if (!controller.signal.aborted)
          errorMessage = err instanceof Error ? err.message : 'Could not load Nyaa results.';
      } finally {
        if (!controller.signal.aborted) loading = false;
      }
    }
    void load();
    return () => controller.abort();
  });
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
      <p id={`${heading}-description`}>
        {appliedQuery === null ? `Episode ${search.episode}` : 'Custom search'} ·
        <a href={nyaaSearchUrl(activeSearch)} target="_blank" rel="noreferrer"
          >Open full search ↗<span class="tw:sr-only"> (opens in a new tab)</span></a
        >
      </p>
    </div>
    <button
      class="close-button"
      type="button"
      aria-label="Close Nyaa results"
      onclick={() => dialog?.close()}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg
      >
    </button>
  </header>
  <form
    class="search-form"
    onsubmit={(event) => {
      event.preventDefault();
      const query = queryDraft.trim();
      if (!query) return;
      appliedQuery = query;
      filter = '';
      attempt++;
    }}
  >
    <div class="search-heading">
      <label for={`${heading}-query`}>Search Nyaa</label>
      {#if appliedQuery !== null || queryDraft !== suggestedQuery}
        <button
          class="search-reset"
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
      />
      <button class="search-submit" type="submit" disabled={!queryDraft.trim()}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg
        >
        Search
      </button>
    </div>
  </form>
  <div class="filter">
    <div class="filter-heading">
      <label for={`${heading}-filter`}>Filter loaded results</label>
      {#if !loading && !errorMessage && releases.length > 0}
        <p class="result-count" role="status">
          {filteredReleases.length} of {releases.length} releases
        </p>
      {/if}
    </div>
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
  </div>
  <section
    bind:this={results}
    id={`${heading}-results`}
    aria-label="Nyaa releases"
    aria-busy={loading}
  >
    {#if loading}
      <p class="message" role="status">
        <span class="tw:loading tw:loading-spinner tw:loading-sm" aria-hidden="true"></span> Searching
        for releases…
      </p>
    {:else if errorMessage}
      <div class="message">
        <p role="alert">{errorMessage}</p>
        <button class="retry" type="button" onclick={() => attempt++}>Try again</button>
      </div>
    {:else if releases.length === 0}
      <p class="message" role="status">No releases found. Try another search query.</p>
    {:else}
      <p class="result-order">Newest first · Latest RSS results</p>
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
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 42rem);
    max-height: 85dvh;
    padding: 22px;
    border: 1px solid var(--border-subtle);
    border-radius: 22px;
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: 0 30px 100px rgb(3 16 35 / 0.35);
    overflow: hidden;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  dialog::backdrop {
    background: rgb(5 18 38 / 0.5);
    backdrop-filter: blur(8px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: 1.15rem;
    font-weight: 800;
    color: var(--text-heading);
    letter-spacing: -0.035em;
    overflow-wrap: anywhere;
  }
  .eyebrow {
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 800;
    color: var(--text-accent);
    margin-bottom: 3px;
  }
  header p:last-child {
    margin-top: 4px;
    font-size: 0.65rem;
    opacity: 0.65;
  }
  a {
    color: var(--text-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  button {
    cursor: pointer;
  }
  .close-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--you-blue-pale);
    color: var(--text-accent);
  }
  .close-button:hover {
    background: var(--sea-blue);
    color: #ffffff;
  }
  .filter,
  .search-form {
    flex: none;
  }
  .search-form {
    padding: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    background: var(--you-blue-pale);
  }
  .search-heading,
  .filter-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .search-heading {
    min-height: 28px;
  }
  label {
    display: block;
    color: var(--text-accent);
    font-size: 0.7rem;
    font-weight: 700;
  }
  .search-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .filter-input {
    position: relative;
  }
  .filter input,
  .search-form input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--you-blue-pale);
    color: var(--color-base-content);
    font-size: 0.8rem;
  }
  .search-form input {
    background: var(--surface);
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
  .search-reset {
    padding: 4px 0;
    background: transparent;
    border: 0;
    color: var(--text-accent);
    font-size: 0.7rem;
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
    border-radius: 12px;
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
    font-size: 0.65rem;
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
    font-weight: 800;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .stat > span {
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  @media (prefers-reduced-motion: reduce) {
    .downloads a {
      transition: none;
    }
  }
  @media (max-width: 480px) {
    dialog {
      padding: 16px;
    }
    .search-form input,
    .filter input {
      font-size: 1rem;
    }
    .search-submit {
      width: 100%;
      padding-inline: 12px;
    }
    .search-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-height: 600px) {
    dialog {
      max-height: calc(100dvh - 24px);
      overflow-y: auto;
    }
    section {
      flex: none;
      max-height: 50dvh;
    }
  }
</style>

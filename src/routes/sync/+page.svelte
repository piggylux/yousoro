<script lang="ts">
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { expireRememberedList } from '#lib/list-data.js';
  import {
    ANILIST_IMPORT_URL,
    ANILIST_UNDO_FILE_NAME,
    IMPORT_FILE_NAMES,
    MAL_EXPORT_URL,
    MAL_IMPORT_URL,
    malImportFile,
  } from '#lib/mal-import.js';
  import { retryAfterSeconds } from '#lib/read-retry.js';
  import { reviewed, saveSyncCheck, syncAccount } from '#lib/sync-check.js';
  import {
    canMix,
    changesFor,
    conflicts,
    defaultMix,
    describeChanges,
    differenceKey,
    importFiles,
    scoreText,
    SYNC_DIRECT_LIMIT,
    type ImportEntry,
    type SyncChoice,
    type SyncEntry,
    type SyncField,
    type SyncItem,
    type SyncPicks,
    type SyncResult,
  } from '#lib/sync.js';
  import { DOMAIN_NAMES, LIST_NAMES, type Domain } from '#lib/types/domain.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Where an anime is copied to, that its entries are mixed, or that it's skipped: copying to
  // MyAnimeList keeps AniList's entry
  type Choice = Domain | 'mix' | 'skip';
  // Mixing is picked anime by anime
  type BulkChoice = Domain | 'skip' | 'suggested';
  // What the control for every anime last set them to
  let bulk = $state<BulkChoice>('suggested');
  const items = $derived(data.linked ? data.items : []);
  // Where each anime is copied to, or that it's skipped, by MyAnimeList id: at first, away from
  // where it changed last
  let choices = $derived<Record<number, Choice>>(
    Object.fromEntries(items.map((item) => [item.malId, item.to]))
  );
  // Which list each part of a mixed anime is taken from, by MyAnimeList id
  let mixes = $state<Record<number, SyncPicks>>({});
  // How each anime applied here went: true when updated, why not when it failed
  let results = $state<Record<number, true | string>>({});
  // The anime in each site's downloaded import file, by MyAnimeList id
  let inFile = $state<Record<Domain, Record<number, true>>>({ anilist: {}, myanimelist: {} });
  let applying = $state(false);
  let status = $state('');
  // A new comparison, as when the page loads again, starts without the last sync's results
  $effect.pre(() => {
    void items;
    mixes = {};
    results = {};
    inFile = { anilist: {}, myanimelist: {} };
    status = '';
    bulk = 'suggested';
  });

  // Every difference listed here counts as reviewed, so the list page doesn't mention it again
  $effect(() => {
    if (!data.linked || !data.user || !data.malUser) return;
    const keys = items.map(differenceKey);
    saveSyncCheck(syncAccount(data.user, data.malUser), reviewed(keys, Date.now()));
  });

  const pending = $derived(
    items.filter((item) => choices[item.malId] !== 'skip' && results[item.malId] !== true)
  );
  // How an anime not skipped is synced: copied to a list, or mixed as picked
  const syncChoice = (item: SyncItem): SyncChoice => {
    const choice = choices[item.malId];
    return choice === 'mix' ? (mixes[item.malId] ?? defaultMix(item)) : (choice as Domain);
  };
  const files = $derived(
    importFiles(pending, Object.fromEntries(pending.map((item) => [item.malId, syncChoice(item)])))
  );
  const held = $derived(new Set(files.held));
  // A few anime are applied here; more would take too many of the requests everyone shares
  const direct = $derived(pending.length > 0 && pending.length <= SYNC_DIRECT_LIMIT);
  const SITES: Domain[] = ['myanimelist', 'anilist'];
  // In the order each anime shows its two entries
  const SIDES: Domain[] = ['anilist', 'myanimelist'];

  const count = (n: number) => (n === 1 ? 'one anime' : `${n} anime`);

  function forgetRememberedLists() {
    if (data.user) expireRememberedList(data.user.name, 'anilist');
    if (data.malUser) expireRememberedList(data.malUser.name, 'myanimelist');
  }

  function saveFile(name: string, entries: ImportEntry[]) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([malImportFile(entries)], { type: 'application/xml' })
    );
    link.download = name;
    link.click();
    // Released once the download has surely started
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  }

  function downloadImportFile(site: Domain) {
    const entries = files[site];
    saveFile(IMPORT_FILE_NAMES[site], entries);
    const added = Object.fromEntries(entries.map((entry) => [entry.malId, true as const]));
    inFile = { ...inFile, [site]: { ...inFile[site], ...added } };
    // Lists this browser kept from before will be out of date once the file is imported
    forgetRememberedLists();
  }

  // A file downloaded before an anime's choice changed holds the old choice, so it's no longer
  // marked as in it, and its file is to be downloaded again
  function unfile(malId: number) {
    delete inFile.anilist[malId];
    delete inFile.myanimelist[malId];
  }

  function choose(item: SyncItem, choice: Choice) {
    // Mixing starts from a guess at where each part changed last
    if (choice === 'mix' && !mixes[item.malId]) mixes[item.malId] = defaultMix(item);
    choices = { ...choices, [item.malId]: choice };
    unfile(item.malId);
  }

  function pick(item: SyncItem, field: SyncField, site: Domain) {
    mixes[item.malId] = { ...(mixes[item.malId] ?? defaultMix(item)), [field]: site };
    unfile(item.malId);
  }

  const FIELD_LABELS: Record<SyncField, string> = {
    progress: 'Status and episodes',
    score: 'Score',
    startedAt: 'Start date',
    completedAt: 'Finish date',
  };

  // An entry's status and episodes, in the words of the site it's on
  const progressText = (entry: SyncEntry, site: Domain) =>
    `${LIST_NAMES[site][entry.status] ?? entry.status} · Ep ${entry.progress}`;

  // One list's value for a part of its entry, as that site shows it
  function fieldValue(entry: SyncEntry, field: SyncField, site: Domain): string {
    if (field === 'progress') return progressText(entry, site);
    if (field === 'score') return scoreText(entry.score100, site);
    return entry[field] ?? '';
  }

  // Sets every anime at once; one that can't be copied that way, as its list doesn't have it, is
  // skipped
  function chooseForAll(choice: BulkChoice) {
    bulk = choice;
    inFile = { anilist: {}, myanimelist: {} };
    const source = (item: SyncItem, to: Domain) =>
      to === 'anilist' ? item.myanimelist : item.anilist;
    choices = Object.fromEntries(
      items.map((item) => [
        item.malId,
        choice === 'suggested'
          ? item.to
          : choice === 'skip' || !source(item, choice)
            ? 'skip'
            : choice,
      ])
    );
  }

  function describe(entry: SyncEntry | null, site: Domain) {
    if (!entry) return 'Not on this list';
    const score = entry.score100 ? ` · ${scoreText(entry.score100, site)}` : '';
    return `${progressText(entry, site)}${score}`;
  }

  // Shown as written, YYYY-MM-DD, so the server and the browser show the same
  function describeDates(entry: SyncEntry | null) {
    return [
      entry?.startedAt && `Started ${entry.startedAt}`,
      entry?.completedAt && `Finished ${entry.completedAt}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /*
   * Applies the few anime chosen, in one request. A busy service leaves its changes untried and says
   * how long to wait; those anime stay chosen, to apply again
   */
  async function apply() {
    const syncing = pending.map((item) => item.malId);
    const changes = pending.flatMap((item) => changesFor(item, syncChoice(item)));
    for (const malId of syncing) delete results[malId];
    applying = true;
    status = 'Updating…';
    let message = '';
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 429) {
        const seconds = retryAfterSeconds(response.headers.get('Retry-After'));
        message = `Too many updates at once. Try again in ${seconds} seconds.`;
      } else if (!response.ok || !Array.isArray(body?.results)) {
        message = body?.message ?? 'Updating stopped, please try again.';
      } else {
        // An anime can take two writes, when a score is copied back: it's updated once both are,
        // the first failure says why it wasn't, and one left untried leaves it to apply again
        const byAnime = new Map<number, SyncResult[]>();
        changes.forEach(({ malId }, i) => {
          byAnime.set(malId, [...(byAnime.get(malId) ?? []), body.results[i] ?? null]);
        });
        for (const [malId, outcomes] of byAnime) {
          const failure = outcomes.find((outcome) => typeof outcome === 'string');
          if (failure) results[malId] = failure;
          else if (outcomes.every((outcome) => outcome === true)) results[malId] = true;
        }
        if (body.stopped) message = body.stopped;
        else if (body.busy) {
          message = `${body.busy.service} is busy. Try the rest again in ${body.busy.retryAfter} seconds.`;
        }
      }
    } catch {
      message = 'Updating stopped. Check your connection and try again.';
    } finally {
      applying = false;
    }
    const updated = syncing.filter((malId) => results[malId] === true).length;
    const failed = syncing.filter((malId) => typeof results[malId] === 'string').length;
    status = [
      updated && `${updated} updated.`,
      failed && `${failed} couldn't be, as said beside them.`,
      message,
    ]
      .filter(Boolean)
      .join(' ');
    if (updated) forgetRememberedLists();
  }
</script>

<section class="sync">
  <h1 class="heading">Sync your lists</h1>
  {#if !data.linked}
    <p class="intro">Sign in to both AniList and MyAnimeList in the settings to sync your lists.</p>
    <a class="tw:btn" href="/settings">Open settings</a>
  {:else if !items.length}
    <p class="intro">Your AniList and MyAnimeList lists already match.</p>
  {:else}
    <p class="intro">
      {items.length === 1 ? 'One anime differs' : `${items.length} anime differ`} between your AniList
      and MyAnimeList lists. Each suggests keeping the entry you changed last, or the one that's further
      along or more complete when that's all that differs. Below each is what syncing changes on each
      list. A date or score only one list has is kept either way, and nothing is deleted. Where the lists
      disagree on more than one thing, as when each has part of your latest changes, Mix takes each part
      from the list you pick.
    </p>
    <label class="bulk">
      <span class="bulk-label">For every anime</span>
      <select
        class="tw:select"
        value={bulk}
        disabled={applying}
        onchange={(event) => chooseForAll(event.currentTarget.value as BulkChoice)}
      >
        <option value="suggested">Keep as suggested</option>
        <option value="myanimelist">Keep AniList’s</option>
        <option value="anilist">Keep MyAnimeList’s</option>
        <option value="skip">Skip</option>
      </select>
    </label>
    <ul class="items">
      {#each items as item (item.malId)}
        {@const choice = choices[item.malId]}
        {@const result = results[item.malId]}
        <li class="item">
          <span class="poster">
            <SharedAnimePoster
              anime={{
                id: item.mediaId ?? item.malId,
                title: item.title,
                isAdult: item.isAdult,
                coverUrl: item.coverUrl,
              }}
              compact
              decorative
              blurMature={data.preferences.blurMature || !data.preferences.showMature}
            />
          </span>
          <div class="details">
            <h2 class="title">{item.title}</h2>
            <dl class="sides">
              {#each SIDES as site (site)}
                {@const entry = item[site]}
                {@const dates = describeDates(entry)}
                <!-- Copying to the other list keeps this one's entry -->
                <div class:kept={choice === (site === 'anilist' ? 'myanimelist' : 'anilist')}>
                  <dt>{DOMAIN_NAMES[site]}</dt>
                  <dd>
                    {describe(entry, site)}
                    {#if dates}<span class="dates">{dates}</span>{/if}
                  </dd>
                </div>
              {/each}
            </dl>
            <select
              class="tw:select choice"
              aria-label={`Which entry to keep for ${item.title}`}
              value={choice}
              disabled={applying || result === true}
              onchange={(event) => choose(item, event.currentTarget.value as Choice)}
            >
              <option value="myanimelist" disabled={!item.anilist}>Keep AniList’s</option>
              <option value="anilist" disabled={!item.myanimelist}>Keep MyAnimeList’s</option>
              {#if canMix(item)}<option value="mix">Mix the two</option>{/if}
              <option value="skip">Skip</option>
            </select>
            {#if choice === 'mix' && result !== true}
              {@const picks = syncChoice(item) as SyncPicks}
              <fieldset class="mix" disabled={applying}>
                <legend class="mix-legend">Take each from</legend>
                {#each conflicts(item) as field (field)}
                  <label class="mix-field">
                    <span class="mix-name">{FIELD_LABELS[field]}</span>
                    <select
                      class="tw:select"
                      value={picks[field]}
                      onchange={(event) => pick(item, field, event.currentTarget.value as Domain)}
                    >
                      {#each SIDES as site (site)}
                        <option value={site}
                          >{DOMAIN_NAMES[site]}: {fieldValue(item[site]!, field, site)}</option
                        >
                      {/each}
                    </select>
                  </label>
                {/each}
              </fieldset>
            {/if}
            {#if result !== undefined}
              <p class="result" class:failed={result !== true}>
                {result === true ? '✓ Updated' : `✕ ${result}`}
              </p>
            {:else if choice !== 'skip'}
              <!-- What syncing changes on each list, so it's clear what keeping one entry means -->
              <ul class="changes">
                {#each describeChanges(item, syncChoice(item)) as change (change.service)}
                  <li>
                    <span class="change-site">{DOMAIN_NAMES[change.service]}:</span>
                    {change.text}
                    {#if inFile[change.service][item.malId]}
                      <span class="filed">· In the downloaded file</span>
                    {/if}
                  </li>
                {/each}
              </ul>
              {#if held.has(item.malId)}
                <p class="held">
                  Left out of AniList’s file, which can’t hold your AniList score exactly. Apply it
                  here, or change it on AniList.
                </p>
              {/if}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if files.myanimelist.length || files.anilist.length}
      <section class="imports" aria-labelledby="import-heading">
        <h2 id="import-heading" class="import-heading">Import into each site</h2>
        <p>
          Each site’s import page takes every anime in its file at once, however many there are.
        </p>
        {#each SITES as site (site)}
          {@const entries = files[site]}
          {@const updates = entries.some((entry) => entry.update)}
          <!-- MyAnimeList's export, linked below, is its backup -->
          {@const undo = site === 'anilist' ? files.undo : []}
          {#if entries.length}
            <section class="import" aria-labelledby={`import-${site}`}>
              <h3 id={`import-${site}`} class="import-site">
                {DOMAIN_NAMES[site]}: {count(entries.length)}
              </h3>
              <ol>
                <li>
                  <span class="downloads">
                    <button
                      class="tw:btn"
                      disabled={applying}
                      onclick={() => downloadImportFile(site)}
                      >Download the file for {DOMAIN_NAMES[site]}</button
                    >
                    {#if undo.length}
                      <button
                        class="tw:btn"
                        disabled={applying}
                        onclick={() => saveFile(ANILIST_UNDO_FILE_NAME, undo)}
                        >Download the undo file</button
                      >
                    {/if}
                  </span>
                  {#if undo.length}
                    <span class="undo-hint">
                      Download the undo file before importing, and keep it: once you’ve imported,
                      this page can’t make it any more. Imported the same way, it puts {undo.length ===
                      1
                        ? 'the one anime already on your list back as it is'
                        : `the ${undo.length} anime already on your list back as they are`} now. Anime
                      the file adds stay on your list.
                    </span>
                  {/if}
                </li>
                {#if site === 'myanimelist'}
                  <li>
                    On <a href={MAL_IMPORT_URL} target="_blank" rel="noopener noreferrer"
                      >MyAnimeList’s import page ↗</a
                    >, choose “MyAnimeList Import” and the file.
                    {#if updates}
                      It updates the anime already on your list. To keep a copy of your list first,
                      <a href={MAL_EXPORT_URL} target="_blank" rel="noopener noreferrer"
                        >export it ↗</a
                      >.
                    {/if}
                  </li>
                {:else}
                  <li>
                    On <a href={ANILIST_IMPORT_URL} target="_blank" rel="noopener noreferrer"
                      >AniList’s import page ↗</a
                    >, choose the file for the MyAnimeList anime list import.
                    {#if updates}
                      Tick “Overwrite anime already on my list”, so the anime already there are
                      updated.
                    {/if}
                  </li>
                {/if}
                <li>Once it’s imported, reload this page to check.</li>
              </ol>
            </section>
          {/if}
        {/each}
      </section>
    {/if}
    <div class="apply">
      {#if direct}
        <button
          class="tw:btn tw:btn-primary"
          onclick={apply}
          disabled={applying}
          aria-busy={applying}
        >
          Apply {count(pending.length)} now
        </button>
      {:else if pending.length}
        <p class="hint">
          {count(pending.length)} chosen: too many to apply here at once. Use the
          <a href="#import-heading">import files</a>, or skip some to apply up to {SYNC_DIRECT_LIMIT}
          here.
        </p>
      {:else}
        <p class="hint">Nothing left to sync.</p>
      {/if}
      <p class="status" role="status">{status}</p>
    </div>
  {/if}
  {#if data.linked && data.unmatched.length}
    <details class="unmatched">
      <summary>
        {data.unmatched.length === 1
          ? 'One anime on AniList isn’t on MyAnimeList'
          : `${data.unmatched.length} anime on AniList aren’t on MyAnimeList`}, so can’t be compared
      </summary>
      <p>{data.unmatched.join(', ')}</p>
    </details>
  {/if}
</section>

<style>
  .sync {
    width: 100%;
    max-width: 40rem;
    margin: 16px auto 0;
  }

  .heading {
    margin-bottom: 12px;
    color: var(--text-heading);
    font-size: 1.75rem;
    font-weight: 600;
  }

  .intro {
    margin-bottom: 20px;
    color: var(--text-accent);
    line-height: 1.5;
  }

  .bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-bottom: 16px;
  }

  .bulk-label {
    color: var(--text-heading);
    font-weight: 600;
  }

  .items {
    display: grid;
    gap: 12px;
    list-style: none;
  }

  .item {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .poster {
    display: block;
  }

  .details {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .title {
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .sides {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    font-size: 0.85rem;
  }

  .sides > div {
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
  }

  /* The entry being kept */
  .sides > .kept {
    border-color: var(--action);
  }

  .sides dt {
    color: var(--text-heading);
    font-weight: 600;
  }

  .sides dd {
    color: var(--text-accent);
  }

  .dates {
    display: block;
    font-size: 0.8rem;
  }

  .choice {
    width: 100%;
    max-width: 16rem;
  }

  .result {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-heading);
  }

  .result.failed {
    color: var(--color-error);
  }

  .mix {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .mix-legend {
    margin-bottom: 4px;
    padding: 0;
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 600;
  }

  .mix-field {
    display: grid;
    gap: 4px;
    color: var(--text-accent);
    font-size: 0.85rem;
  }

  .mix-field select {
    width: 100%;
    max-width: 20rem;
  }

  .changes {
    display: grid;
    gap: 4px;
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.5;
    list-style: none;
    overflow-wrap: anywhere;
  }

  .change-site {
    color: var(--text-heading);
    font-weight: 600;
  }

  .filed {
    color: var(--text-heading);
  }

  .held {
    color: var(--text-accent);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .imports {
    display: grid;
    gap: 12px;
    margin-top: 24px;
    color: var(--text-accent);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .import {
    display: grid;
    gap: 8px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }

  .import-heading {
    color: var(--text-heading);
    font-size: 1.15rem;
    font-weight: 600;
  }

  .import-site {
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
  }

  .downloads {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .undo-hint {
    display: block;
    margin-top: 8px;
  }

  .import ol {
    display: grid;
    gap: 8px;
    padding-left: 1.25rem;
    list-style: decimal;
  }

  .imports a,
  .hint a {
    text-decoration: underline;
  }

  .apply {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: 8px;
    margin-top: 16px;
    padding: 16px 0;
    background: var(--surface-muted);
  }

  .hint {
    color: var(--text-accent);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .status {
    min-height: 1.5em;
    color: var(--text-accent);
    font-size: 0.85rem;
  }

  .unmatched {
    margin-top: 16px;
    color: var(--text-accent);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }

  .unmatched summary {
    cursor: pointer;
  }

  .unmatched p {
    margin-top: 8px;
  }

  @media (max-width: 480px) {
    .item {
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
    }

    .sides {
      grid-template-columns: 1fr;
    }

    .choice,
    .mix-field select {
      max-width: none;
    }
  }
</style>

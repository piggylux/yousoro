<script lang="ts">
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { expireRememberedList } from '#lib/list-data.js';
  import { MAL_IMPORT_URL, malImportFile } from '#lib/mal-import.js';
  import { retryAfterSeconds } from '#lib/read-retry.js';
  import {
    changesFor,
    SYNC_BATCH_SIZE,
    type SyncEntry,
    type SyncItem,
    type SyncResult,
  } from '#lib/sync.js';
  import type { Domain } from '#lib/types/domain.js';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type Choice = Domain | 'skip';
  type BulkChoice = Choice | 'suggested';
  // What the control for every anime last set them to
  let bulk = $state<BulkChoice>('suggested');
  const items = $derived(data.linked ? data.items : []);
  // Where each anime is copied to, or that it's skipped, by MyAnimeList id: at first, away from
  // where it changed last
  let choices = $derived<Record<number, Choice>>(
    Object.fromEntries(items.map((item) => [item.malId, item.to]))
  );
  // How each anime tried so far went: true when updated, why not when it failed
  let results = $state<Record<number, true | string>>({});
  // Anime left to MyAnimeList's import page, by MyAnimeList id, once their file is downloaded
  let imported = $state<Record<number, true>>({});
  let applying = $state(false);
  let done = $state(0);
  let total = $state(0);
  let status = $state('');
  // A new comparison, as when the page loads again, starts without the last sync's results
  $effect.pre(() => {
    void items;
    results = {};
    imported = {};
    done = 0;
    total = 0;
    status = '';
    bulk = 'suggested';
  });

  const pending = $derived(
    items.filter(
      (item) =>
        choices[item.malId] !== 'skip' && results[item.malId] !== true && !imported[item.malId]
    )
  );

  /*
   * Anime to add to MyAnimeList, which takes changes one at a time here, about 40 a minute, but adds
   * a whole file of them at once on its import page. Only additions go in the file: it can't touch
   * an anime already on the list without risking what the file doesn't hold, like its tags
   */
  const toAdd = $derived(
    pending.filter(
      (item) => choices[item.malId] === 'myanimelist' && item.anilist && !item.myanimelist
    )
  );

  function downloadImportFile() {
    const file = malImportFile(
      toAdd.map((item) => ({
        malId: item.malId,
        title: item.title,
        entry: changesFor(item, 'myanimelist')[0].entry,
      }))
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([file], { type: 'application/xml' }));
    link.download = 'yousoro-myanimelist-import.xml';
    link.click();
    // Released once the download has surely started
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    imported = { ...imported, ...Object.fromEntries(toAdd.map((item) => [item.malId, true])) };
  }

  // Sets every anime at once; one that can't be copied that way, as its list doesn't have it, is
  // skipped
  function chooseForAll(choice: BulkChoice) {
    bulk = choice;
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

  const STATUS_LABELS: Record<string, string> = {
    CURRENT: 'Watching',
    REPEATING: 'Rewatching',
    COMPLETED: 'Completed',
    PAUSED: 'Paused',
    DROPPED: 'Dropped',
    PLANNING: 'Planning',
  };

  function describe(entry: SyncEntry | null) {
    if (!entry) return 'Not on this list';
    const score = entry.score100 ? ` · ${Number((entry.score100 / 10).toFixed(1))}/10` : '';
    return `${STATUS_LABELS[entry.status] ?? entry.status} · Ep ${entry.progress}${score}`;
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

  const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  /*
   * Sends the changes a few at a time. Both services limit how much they take in a minute: changes a
   * busy one couldn't take come back untried, and the page waits as long as it says before sending
   * them again, while the other service's changes carry on
   */
  async function apply() {
    const syncing = pending.map((item) => item.malId);
    const queue = pending.flatMap((item) => changesFor(item, choices[item.malId] as Domain));
    for (const malId of syncing) delete results[malId];
    applying = true;
    done = 0;
    total = queue.length;
    // Said once: the count beside the progress bar changes too often to be read out each time
    status = 'Syncing…';
    let stopped = '';
    try {
      while (queue.length) {
        const batch = queue.slice(0, SYNC_BATCH_SIZE);
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: batch }),
        });
        if (response.status === 429) {
          const seconds = retryAfterSeconds(response.headers.get('Retry-After'));
          status = `Carrying on in ${seconds} seconds, so as not to send too much at once…`;
          await wait(seconds);
          continue;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body?.results)) {
          stopped = body?.message ?? 'Syncing stopped, please try again.';
          break;
        }
        const untried = batch.filter((change, i) => {
          const result: SyncResult = body.results[i] ?? null;
          if (result === null) return true;
          // An anime can take two writes, when a score is copied back; it's updated once both are,
          // and the first failure says why it wasn't
          if (results[change.malId] === undefined || results[change.malId] === true) {
            results[change.malId] = result;
          }
          done++;
          return false;
        });
        queue.splice(0, batch.length, ...untried);
        if (body.stopped) {
          stopped = body.stopped;
          break;
        }
        if (body.busy) {
          // The service may have refused, or this site may be pacing itself to stay within limits
          status = `Waiting for ${body.busy.service}: syncing carries on in ${body.busy.retryAfter} seconds…`;
          await wait(body.busy.retryAfter);
        } else if (untried.length === batch.length) break;
      }
    } catch {
      stopped = 'Syncing stopped. Check your connection and try again.';
    } finally {
      applying = false;
    }
    const updated = syncing.filter((malId) => results[malId] === true).length;
    const failed = syncing.filter((malId) => typeof results[malId] === 'string').length;
    status =
      stopped ||
      (failed
        ? `${updated} updated. ${failed} couldn't be, as said beside them.`
        : `All ${updated} updated.`);
    // Lists this browser kept from before are out of date now
    if (data.user) expireRememberedList(data.user.name, 'anilist');
    if (data.malUser) expireRememberedList(data.malUser.name, 'myanimelist');
  }
</script>

<!-- Leaving the page stops a sync partway, as it runs in the page -->
<svelte:window
  onbeforeunload={(event) => {
    if (applying) event.preventDefault();
  }}
/>

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
      and MyAnimeList lists. Each is copied from the list you changed last, or from the one that's further
      along when both have it with the same status, unless you choose otherwise. Nothing is deleted.
    </p>
    <label class="bulk">
      <span class="bulk-label">For every anime</span>
      <select
        class="tw:select"
        value={bulk}
        disabled={applying}
        onchange={(event) => chooseForAll(event.currentTarget.value as BulkChoice)}
      >
        <option value="suggested">Copy as suggested</option>
        <option value="myanimelist">Copy AniList to MyAnimeList</option>
        <option value="anilist">Copy MyAnimeList to AniList</option>
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
              {#each [{ name: 'AniList', entry: item.anilist, source: choice === 'myanimelist' }, { name: 'MyAnimeList', entry: item.myanimelist, source: choice === 'anilist' }] as side (side.name)}
                {@const dates = describeDates(side.entry)}
                <div class:source={side.source}>
                  <dt>{side.name}</dt>
                  <dd>
                    {describe(side.entry)}
                    {#if dates}<span class="dates">{dates}</span>{/if}
                  </dd>
                </div>
              {/each}
            </dl>
            <select
              class="tw:select choice"
              aria-label={`What to do with ${item.title}`}
              value={choice}
              disabled={applying || result === true}
              onchange={(event) =>
                (choices = { ...choices, [item.malId]: event.currentTarget.value as Choice })}
            >
              <option value="myanimelist" disabled={!item.anilist}>Copy to MyAnimeList</option>
              <option value="anilist" disabled={!item.myanimelist}>Copy to AniList</option>
              <option value="skip">Skip</option>
            </select>
            {#if imported[item.malId]}
              <p class="result">→ In the MyAnimeList import file</p>
            {:else if result !== undefined}
              <p class="result" class:failed={result !== true}>
                {result === true ? '✓ Updated' : `✕ ${result}`}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <!-- A few anime sync in moments; the file is worth its extra steps for more -->
    {#if toAdd.length >= 10}
      <section class="import" aria-labelledby="import-heading">
        <h2 id="import-heading" class="import-heading">
          Add {toAdd.length} anime to MyAnimeList at once
        </h2>
        <p>
          Syncing adds them one at a time, as MyAnimeList takes about 40 changes a minute from this
          site. Its import page adds them all at once instead.
        </p>
        <ol>
          <li>
            <button class="tw:btn tw:btn-sm" disabled={applying} onclick={downloadImportFile}
              >Download the import file</button
            >
          </li>
          <li>
            On <a href={MAL_IMPORT_URL} target="_blank" rel="noopener noreferrer"
              >MyAnimeList’s import page ↗</a
            >, choose “MyAnimeList Import” and the file. Anime already on your list stay as they
            are.
          </li>
          <li>Once it’s imported, reload this page to check.</li>
        </ol>
      </section>
    {/if}
    <div class="apply">
      <button
        class="tw:btn tw:btn-primary"
        onclick={apply}
        disabled={applying || !pending.length}
        aria-busy={applying}
      >
        {pending.length ? `Sync ${pending.length} anime` : 'Nothing left to sync'}
      </button>
      {#if total}
        <div class="progress">
          <progress class="tw:progress" value={done} max={total} aria-label="Sync progress"
          ></progress>
          <span>{done} of {total}</span>
        </div>
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

  /* The list being copied from */
  .sides > .source {
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

  .import {
    display: grid;
    gap: 8px;
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--text-accent);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .import-heading {
    color: var(--text-heading);
    font-size: 1rem;
    font-weight: 600;
  }

  .import ol {
    display: grid;
    gap: 8px;
    padding-left: 1.25rem;
    list-style: decimal;
  }

  .import a {
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

  .progress {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-accent);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .progress progress {
    flex: 1;
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

    .choice {
      max-width: none;
    }
  }
</style>

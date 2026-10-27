<script lang="ts">
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import type { FriendWatching, SharedAnime } from '#lib/types/friend-watching.js';

  let {
    selection,
    blurMature = true,
    partial = false,
    onclose,
  }: {
    selection: {
      friend: Pick<FriendWatching, 'id' | 'name' | 'avatarUrl'>;
      anime: (SharedAnime & { progress: number; rewatching: boolean })[];
    } | null;
    blurMature?: boolean;
    partial?: boolean;
    onclose: () => void;
  } = $props();
  const heading = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let results = $state<HTMLDivElement>();
  let search = $state('');
  let limit = $state(36);
  const query = $derived(search.trim().toLocaleLowerCase());
  const filtered = $derived(
    (selection?.anime ?? []).filter((anime) => anime.title.toLocaleLowerCase().includes(query))
  );
  $effect(() => {
    void query;
    limit = 36;
    if (results) results.scrollTop = 0;
  });
  $effect(() => {
    if (selection && dialog && !dialog.open) {
      search = '';
      limit = 36;
      dialog.showModal();
    } else if (!selection && dialog?.open) dialog.close();
  });
</script>

<dialog
  use:closeOnBackdrop
  bind:this={dialog}
  style:--dialog-height={selection && selection.anime.length > 12
    ? 'min(85dvh, 740px)'
    : 'fit-content'}
  aria-labelledby={heading}
  aria-describedby={`${heading}-description`}
  {onclose}
>
  {#if selection}
    <header>
      <FriendAvatar {...selection.friend} size={40} />
      <div class="heading-copy">
        <p class="eyebrow">Watching together</p>
        <h2 id={heading}>You &amp; {selection.friend.name}</h2>
        <p id={`${heading}-description`}>
          {selection.anime.length}{partial ? '+' : ''} shared anime · links open in a new tab
        </p>
      </div>
      <button
        type="button"
        class="close"
        aria-label="Close shared anime"
        onclick={() => dialog?.close()}>×</button
      >
    </header>
    <input
      class="search"
      type="search"
      bind:value={search}
      placeholder="Find a shared anime"
      aria-label="Search shared anime"
    />
    {#if partial}<p class="partial">
        Showing available matches. More shared anime may be missing.
      </p>{/if}
    <div class="results" bind:this={results}>
      <p class="result-count" role="status">{filtered.length} anime{query ? ' found' : ''}</p>
      <ul>
        {#each filtered.slice(0, limit) as anime (anime.id)}
          <li><SharedAnimePoster {anime} {blurMature} /></li>
        {/each}
      </ul>
      {#if !filtered.length}<p class="empty">
          {query ? `No shared anime matches “${search.trim()}”.` : 'No shared anime available.'}
        </p>{/if}
      {#if filtered.length > limit}<button
          type="button"
          class="show-more"
          onclick={() => (limit += 36)}>Show {Math.min(36, filtered.length - limit)} more</button
        >{/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 42rem);
    height: var(--dialog-height);
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
    gap: 12px;
    align-items: center;
    flex: none;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
  }
  .eyebrow {
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 800;
    color: var(--text-accent);
    margin-bottom: 3px;
  }
  h2 {
    color: var(--text-heading);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.035em;
    overflow-wrap: anywhere;
  }
  header p:last-child {
    margin-top: 4px;
    font-size: 0.65rem;
    opacity: 0.65;
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    height: 32px;
    width: 32px;
    border-radius: 50%;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 1.25rem;
    cursor: pointer;
  }
  .search {
    flex: none;
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--you-blue-pale);
    font-size: 0.8rem;
  }
  .partial {
    flex: none;
    font-size: 0.7rem;
    color: var(--text-accent);
  }
  .results {
    flex: 1;
    overflow: auto;
    min-height: 0;
    padding: 3px 5px 8px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .result-count {
    font-size: 0.65rem;
    opacity: 0.6;
    margin-bottom: 12px;
  }
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 12px;
    list-style: none;
    padding: 0;
  }
  li {
    min-width: 0;
  }
  .show-more {
    display: block;
    margin: 20px auto 0;
    padding: 9px 18px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.75rem;
    font-weight: 650;
    cursor: pointer;
  }
  .empty {
    text-align: center;
    padding: 24px 0;
    opacity: 0.65;
    font-size: 0.8rem;
  }
  input:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
</style>

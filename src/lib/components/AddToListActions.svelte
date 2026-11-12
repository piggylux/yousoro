<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';

  import type { FoundAnime, FoundState } from '#lib/anime-search.js';
  import type { Add, ListAdds } from '#lib/list-adds.svelte.js';
  import type { Before, ListMove } from '#lib/types/api.js';

  /*
   * The one thing to do with an anime the page found, at the end of its row: start, resume, show,
   * plan, or start or plan it, with Undo once it's done, and what went wrong under them. Its parent
   * lays them out, wrapping, so the notes take a line of their own. Where the parent is a container
   * narrower than a phone's row, the buttons take the whole width, and planning beside starting is
   * a square bookmark, its name left to screen readers
   */
  type Props = {
    adds: ListAdds;
    anime: FoundAnime;
    /** Where the anime is on the viewer's lists, as far as the page knows */
    where: FoundState;
    /** Goes to the anime's card on the list, when the page shows cards */
    onShow?: (animeId: number) => void;
    /** Where focus goes when a save took away the button that had it: the anime's own link */
    focusFallback: () => HTMLElement | null | undefined;
    /**
     * The page read the viewer's own list itself and knows where the anime is, so a save needn't
     * ask the list's service first: one request instead of two (see addToListAction)
     */
    known?: boolean;
  };

  let { adds, anime, where, onShow, focusFallback, known = false }: Props = $props();
  const entry = $derived(adds.get(anime.id));
  const action = $derived(adds.actionFor(anime, where, !!onShow));
  const undoable = $derived(adds.undoable(anime.id));

  /*
   * Disabling a button while it saves takes its focus, and a save can take the button away: focus
   * then goes back to try again, or to the anime, unless the viewer has moved it on meanwhile
   */
  async function settled(ok: boolean, form: HTMLFormElement) {
    await tick();
    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      !active.isConnected ||
      active === form.closest('dialog');
    if (!lost) return;
    if (ok) focusFallback()?.focus();
    else form.querySelector('button')?.focus();
  }
</script>

{#snippet bookmark()}
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" /></svg
  >
{/snippet}

<!--
  Undoes an add, sending the list it went to, where it was, and where it was on the linked account
  when the add changed that too
-->
{#snippet undoForm(entry: Add)}
  <form method="POST" action="?/undoAdd" use:enhance={adds.undo(anime, settled)}>
    <input type="hidden" name="mediaId" value={anime.id} />
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <input type="hidden" name="list" value={entry.added} />
    <input type="hidden" name="before" value={entry.before} />
    {#if entry.linkedBefore}<input
        type="hidden"
        name="linkedBefore"
        value={entry.linkedBefore}
      />{/if}
    <button
      class="tw:btn tw:btn-sm tw:btn-ghost action"
      disabled={entry.saving}
      aria-busy={entry.undoing}
      aria-label={`Undo: ${anime.title}`}
    >
      {#if entry.undoing}<span
          class="tw:loading tw:loading-spinner tw:loading-xs"
          aria-hidden="true"
        ></span>{:else}Undo{/if}
    </button>
  </form>
{/snippet}

<!--
  Adds an anime by its AniList id, and its MyAnimeList id, which a MyAnimeList list needs, once the
  server has checked where it is on the list and on the linked account: `from` the plan, paused or
  dropped list the page saw it on, for a move, which stays put if it has moved on since. A retry
  after the linked account missed the add only tries that account again. Planning has a bookmark;
  beside "Start" in a narrow row, it's only the bookmark
-->
{#snippet addForm(
  list: ListMove,
  label: string,
  name: string,
  how: 'add' | 'move' | 'retry',
  look: 'plain' | 'compact' = 'plain',
  from?: Before
)}
  {@const saving = entry?.saving ?? false}
  <!-- Waiting on an undo, it can't be pressed, but it isn't what's busy -->
  {@const busy = saving && !entry?.undoing}
  <!-- Vouched for, where the page saw it goes too, on no list included; a retry always asks -->
  {@const vouched = known && how !== 'retry'}
  {@const sentFrom = vouched ? (from ?? 'NONE') : from}
  <form
    method="POST"
    action="?/addAnime"
    use:enhance={adds.add(anime, list, { moved: how === 'move', from, settled })}
  >
    <input type="hidden" name="mediaId" value={anime.id} />
    {#if anime.malId !== null}<input type="hidden" name="malId" value={anime.malId} />{/if}
    <input type="hidden" name="list" value={list} />
    {#if sentFrom}<input type="hidden" name="from" value={sentFrom} />{/if}
    {#if vouched}<input type="hidden" name="known" value="1" />{/if}
    {#if how === 'retry'}<input type="hidden" name="retry" value="linked" />{/if}
    <button
      class={['tw:btn tw:btn-sm', 'action', look === 'compact' && 'compact-action']}
      disabled={saving}
      aria-busy={busy}
      aria-label={`${name}: ${anime.title}`}
    >
      {#if busy}<span class="tw:loading tw:loading-spinner tw:loading-xs" aria-hidden="true"
        ></span>{:else}
        {#if list === 'PLANNING' && how !== 'retry'}{@render bookmark()}{/if}
        <span class={look === 'compact' ? 'compact-label' : undefined}>{label}</span>
      {/if}
    </button>
  </form>
{/snippet}

<!-- There even when empty, as a narrow row keeps a line for it under each anime -->
<div class="row-actions">
  {#if action || undoable}
    {#if action === 'start'}
      {@render addForm('CURRENT', 'Start', 'Start watching', 'move', 'plain', 'PLANNING')}
    {:else if action === 'resume' && where.kind === 'listed'}
      {@render addForm(
        'CURRENT',
        'Resume',
        'Resume watching',
        'move',
        'plain',
        where.list as Before
      )}
    {:else if action === 'show'}
      <button
        type="button"
        class="tw:btn tw:btn-sm action"
        aria-label={`Show on my list: ${anime.title}`}
        onclick={() => onShow?.(anime.id)}>Show</button
      >
    {:else if action === 'plan'}
      {@render addForm('PLANNING', 'Plan', 'Add to Planning', 'add')}
    {:else if action === 'add'}
      {@render addForm('CURRENT', 'Start', 'Start watching', 'add')}
      {@render addForm('PLANNING', 'Plan', 'Add to Planning', 'add', 'compact')}
    {/if}
    {#if undoable}{@render undoForm(entry!)}{/if}
  {/if}
</div>
{#if (entry?.added && entry.linked) || entry?.message}
  <div class="notes">
    {#if entry?.added && entry.linked}
      <p class="tw:text-error" role="alert">{entry.linked.message}</p>
      <!-- Moved from a list, it says which, as the linked account is likely on it too -->
      {#if entry.linked.retry}{@render addForm(
          entry.added,
          'Try again',
          'Try again',
          'retry',
          'plain',
          entry.moved ? entry.before : undefined
        )}{/if}
    {/if}
    {#if entry?.message}<p class="tw:text-error" role="alert">{entry.message}</p>{/if}
  </div>
{/if}

<style>
  .row-actions {
    display: flex;
    flex: none;
    gap: 6px;
    margin-left: auto;
  }

  .action {
    min-width: 4.5rem;
    gap: 4px;
  }

  /* Under the row, the whole width of it */
  .notes {
    display: flex;
    flex: 1 1 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  /* Touch screens and phones get buttons big enough to tap */
  @media (pointer: coarse), (max-width: 480px) {
    .action {
      min-height: 44px;
    }
  }

  /*
   * In a row as narrow as a phone's, the buttons take the line under the anime. Planning beside
   * starting is a square bookmark there, its name left to screen readers, as there's no room to say
   * it
   */
  @container (max-width: 26.5rem) {
    /* Kept, empty or not, so an anime with nothing to do is as tall as the rest */
    .row-actions {
      flex: 1 1 100%;
      min-height: 44px;
    }

    .row-actions > form,
    .row-actions > .action {
      flex: 1;
    }

    .row-actions .action {
      width: 100%;
      min-height: 44px;
    }

    .row-actions > form:has(.compact-action) {
      flex: none;
    }

    .row-actions .compact-action {
      width: 44px;
      min-width: 0;
      padding: 0;
    }

    .compact-label {
      display: none;
    }
  }
</style>

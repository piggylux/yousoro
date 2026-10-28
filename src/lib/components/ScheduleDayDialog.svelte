<script lang="ts">
  import type { CalendarEpisode } from '#lib/calendar.js';
  import CloseButton from '#lib/components/CloseButton.svelte';
  import ScheduledEpisodeLink from '#lib/components/ScheduledEpisodeLink.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  let {
    selection,
    blurMature = true,
    partial = false,
    onclose,
  }: {
    selection: { date: Date; episodes: CalendarEpisode[] } | null;
    blurMature?: boolean;
    partial?: boolean;
    onclose: () => void;
  } = $props();
  const heading = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let episodeList = $state<HTMLUListElement>();
  const selectedDay = $derived(selection?.date.getTime());
  $effect(() => {
    void selectedDay;
    if (episodeList) episodeList.scrollTop = 0;
  });
  $effect(() => {
    if (selection && dialog && !dialog.open) dialog.showModal();
    else if (!selection && dialog?.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} use:closeOnBackdrop aria-labelledby={heading} {onclose}>
  {#if selection}
    <header>
      <div>
        <p>Airing times from AniList</p>
        <h2 id={heading}>
          {selection.date.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </h2>
        <p>
          {selection.episodes.length} scheduled episodes · Local time{partial
            ? ' · Incomplete schedule'
            : ''}
        </p>
      </div>
      <CloseButton label="Close day schedule" onclick={() => dialog?.close()} />
    </header>
    <ul bind:this={episodeList} aria-label="Scheduled episodes">
      {#each selection.episodes as entry (`${entry.anime.id}:${entry.episode}`)}<li>
          <ScheduledEpisodeLink {entry} {blurMature} />
        </li>{:else}<li class="empty-results">No scheduled episodes for this day.</li>{/each}
    </ul>
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 32rem);
    max-height: 80dvh;
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
  header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    flex: none;
  }
  header > div {
    flex: 1;
    min-width: 0;
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-heading);
    margin: 4px 0;
  }
  p {
    color: var(--text-accent);
    font-size: 0.75rem;
  }
  ul {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    padding: 4px;
    scrollbar-gutter: stable;
  }
  .empty-results {
    padding: 24px 8px;
    text-align: center;
    font-size: 0.85rem;
    color: var(--text-accent);
  }
  li + li {
    border-top: 1px solid var(--border-subtle);
    padding-top: 5px;
    margin-top: 5px;
  }
  @media (max-height: 600px) {
    dialog {
      max-height: calc(100dvh - 24px);
    }
    ul {
      max-height: 50dvh;
    }
  }
</style>

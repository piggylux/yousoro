<script lang="ts">
  import type { CalendarEpisode } from '#lib/calendar.js';
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
          {selection.episodes.length} upcoming episodes · Local time{partial
            ? ' · Incomplete schedule'
            : ''}
        </p>
      </div>
      <button type="button" aria-label="Close day schedule" onclick={() => dialog?.close()}
        >×</button
      >
    </header>
    <ul>
      {#each selection.episodes as entry (`${entry.anime.id}:${entry.episode}`)}<li>
          <ScheduledEpisodeLink {entry} {blurMature} />
        </li>{/each}
    </ul>
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 32rem);
    max-height: 80dvh;
    padding: 20px;
    border: 1px solid var(--border-subtle);
    border-radius: 22px;
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: 0 30px 90px rgb(3 16 35 / 0.35);
    overflow: hidden;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  dialog::backdrop {
    background: rgb(5 18 38 / 0.5);
    backdrop-filter: blur(6px);
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
    font-weight: 800;
    color: var(--text-heading);
    margin: 4px 0;
  }
  p {
    color: var(--text-accent);
    font-size: 0.75rem;
  }
  button {
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: 50%;
    background: var(--you-blue-pale);
    cursor: pointer;
    font-size: 1.5rem;
  }
  button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  ul {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    padding: 4px;
  }
  li + li {
    border-top: 1px solid var(--border-subtle);
    padding-top: 5px;
    margin-top: 5px;
  }
</style>

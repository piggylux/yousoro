<script lang="ts">
  import type { Snippet } from 'svelte';

  import SharedAnimePoster from '#lib/components/SharedAnimePoster.svelte';
  import type { SharedAnime } from '#lib/types/friend-watching.js';

  let {
    anime,
    href,
    label,
    blurMature = true,
    details,
    action,
    notes,
  }: {
    anime: SharedAnime;
    /** The anime's own page, which opens in a new tab */
    href: string;
    /** What the link is called, when its text doesn't say it all; it should say it opens a new tab */
    label?: string;
    /** The viewer's setting: blur covers of anime marked as adult */
    blurMature?: boolean;
    /** What's said under the title */
    details: Snippet;
    /** A control beside the anime, as a button; under it on a narrow row */
    action?: Snippet;
    /** Messages about the anime, across the row under it */
    notes?: Snippet;
  } = $props();
</script>

<!-- A compact cover and title in a row, the whole of it a link but for its action -->
<div class="anime-row">
  <div class="row-layout">
    <a class="row-link" {href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      <span class="row-cover">
        <SharedAnimePoster {anime} compact decorative {blurMature} />
      </span>
      <span class="row-text">
        <span class="row-title">{anime.title}</span>
        {@render details()}
        {#if !label}<span class="tw:sr-only">, opens in a new tab</span>{/if}
      </span>
    </a>
    {#if action}<div class="row-action">{@render action()}</div>{/if}
    {#if notes}<div class="row-notes">{@render notes()}</div>{/if}
  </div>
</div>

<style>
  .anime-row {
    container: anime-row / inline-size;
    height: 100%;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .anime-row:has(.row-link:hover) {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }

  .row-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px 12px;
    height: 100%;
  }

  .row-link {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    height: 100%;
    border-radius: var(--radius-control);
  }

  .row-cover {
    flex: none;
    width: 44px;
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-title {
    color: var(--text-heading);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .row-notes {
    grid-column: 1 / -1;
  }

  /* A narrow row puts its action under the anime, across the row */
  @container anime-row (max-width: 26rem) {
    .row-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .row-action {
      display: grid;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .anime-row {
      transition: none;
    }
  }
</style>

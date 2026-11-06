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
  }: {
    anime: Omit<SharedAnime, 'id'> & { id: number | null; malId?: number | null };
    /** The anime's own page, which opens in a new tab */
    href: string;
    /** What the link is called, when its text doesn't say it all; it should say it opens a new tab */
    label?: string;
    /** The viewer's setting: blur covers of anime marked as adult */
    blurMature?: boolean;
    /** What's said under the title */
    details: Snippet;
  } = $props();
</script>

<!-- A compact cover and title in a row, the whole of it a link -->
<a class="anime-row" {href} target="_blank" rel="noopener noreferrer" aria-label={label}>
  <span class="row-cover">
    <SharedAnimePoster {anime} compact decorative {blurMature} />
  </span>
  <span class="row-text">
    <span class="row-title">{anime.title}</span>
    {@render details()}
    {#if !label}<span class="tw:sr-only">, opens in a new tab</span>{/if}
  </span>
</a>

<style>
  .anime-row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100%;
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .anime-row:hover {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
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

  @media (prefers-reduced-motion: reduce) {
    .anime-row {
      transition: none;
    }
  }
</style>

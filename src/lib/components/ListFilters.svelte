<script lang="ts">
  import { onMount } from 'svelte';

  import { LIST_SECTION_LABELS, LIST_SECTIONS, type ListSection } from '#lib/anime.js';

  type Props = {
    /** How many anime are in each section of the whole list */
    counts: Record<ListSection, number>;
    /** The sections the viewer hides */
    hidden: ListSection[];
    onToggle: (section: ListSection) => void;
    /** Words to look for in the anime's titles */
    search: string;
  };

  let { counts, hidden, onToggle, search = $bindable() }: Props = $props();

  let searchInput = $state<HTMLInputElement>();

  export function focusSearch() {
    searchInput?.focus();
  }
  // Words typed before the page's script took over are in the field but not in `search` yet
  onMount(() => {
    if (searchInput && searchInput.value !== search) search = searchInput.value;
  });

  // Empty sections have nothing to filter, unless they're hidden, so they can be shown again
  const sections = $derived(
    LIST_SECTIONS.filter((section) => counts[section] > 0 || hidden.includes(section))
  );
</script>

<div class="list-toolbar">
  <!--
    Filters as the viewer types. Escape clears it, in every browser: Firefox doesn't do it for
    search fields by itself
  -->
  <input
    type="search"
    class="search"
    placeholder="Search titles"
    aria-label="Search titles"
    autocomplete="off"
    spellcheck="false"
    bind:this={searchInput}
    bind:value={search}
    onkeydown={(event) => {
      if (event.key === 'Escape' && search) {
        event.preventDefault();
        search = '';
      }
    }}
  />

  <!-- Each chip shows or hides one section of the list; a pressed chip's section is shown -->
  <div class="list-filters" role="group" aria-label="Sections to show">
    {#each sections as section (section)}
      {@const shown = !hidden.includes(section)}
      <button type="button" class="chip" aria-pressed={shown} onclick={() => onToggle(section)}>
        <span class="check" aria-hidden="true">{shown ? '✓' : ''}</span>
        {LIST_SECTION_LABELS[section]}
        <span class="count">{counts[section].toLocaleString()}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .list-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    /* Separate the toolbar from the first row of cards. */
    margin: 0 0 32px;
    padding: 16px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .list-filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 8px;
  }

  .search {
    width: 14rem;
    max-width: 100%;
    height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text-heading);
    font-size: 0.85rem;
  }

  .search::placeholder {
    color: var(--text-accent);
  }

  .search:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }

  /* On a phone, the search gets a row of its own, above the chips */
  @media (max-width: 480px) {
    .search {
      width: 100%;
    }
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px 0 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text-heading);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.15s ease-out,
      color 0.15s ease-out;
  }

  .chip[aria-pressed='false'] {
    border-color: var(--border-subtle);
    border-style: solid;
    background: transparent;
    box-shadow: none;
    color: var(--text-accent);
  }

  .chip:hover {
    filter: none;
    background: var(--you-blue-pale);
  }

  .chip:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }

  /* Holds its place when empty, so a chip keeps its width as it's toggled */
  .check {
    width: 0.8em;
    text-align: center;
  }

  /* Counts use a quiet neutral surface and stable numeric spacing. */
  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-muted);
    font-size: 0.75rem;
    color: var(--text-accent);
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
  .chip[aria-pressed='true'] {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
  }
  .check {
    color: var(--you-blue);
  }

  @media (pointer: coarse) {
    .search,
    .chip {
      min-height: 44px;
    }
  }
</style>

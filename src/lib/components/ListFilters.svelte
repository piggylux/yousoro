<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  /** A toggle beside the search, with how many anime it covers on the whole list */
  type FilterChip = { key: string; label: string; count: number; pressed: boolean };

  type Props = {
    /** The toggles, in order; without them only the search shows */
    chips?: FilterChip[];
    /** What the toggles do together, for screen readers */
    chipsLabel?: string;
    onToggle?: (key: string) => void;
    /** Words to look for in the anime's titles */
    search: string;
    /** More controls after the toggles, as a plan list's genre and order */
    children?: Snippet;
  };

  let { chips = [], chipsLabel, onToggle, search = $bindable(), children }: Props = $props();

  let searchInput = $state<HTMLInputElement>();

  export function focusSearch() {
    searchInput?.focus();
  }
  // Words typed before the page's script took over are in the field but not in `search` yet
  onMount(() => {
    if (searchInput && searchInput.value !== search) search = searchInput.value;
  });
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

  {#if chips.length || children}
    <div class="list-filters">
      {#if chips.length}
        <div class="chips" role="group" aria-label={chipsLabel}>
          {#each chips as chip (chip.key)}
            <button
              type="button"
              class="chip"
              aria-pressed={chip.pressed}
              onclick={() => onToggle?.(chip.key)}
            >
              <span class="check" aria-hidden="true">{chip.pressed ? '✓' : ''}</span>
              {chip.label}
              <span class="count">{chip.count.toLocaleString()}</span>
            </button>
          {/each}
        </div>
      {/if}
      {@render children?.()}
    </div>
  {/if}
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

  .list-filters,
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
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

  /* A menu among the controls, as a plan list's genre and order, matches the search and chips */
  .list-filters :global(select) {
    width: auto;
    max-width: 100%;
    height: 40px;
    border-radius: var(--radius-control);
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
    .chip,
    .list-filters :global(select) {
      min-height: 44px;
    }
  }
</style>

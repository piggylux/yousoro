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
      <button
        type="button"
        class="chip {section}"
        aria-pressed={shown}
        onclick={() => onToggle(section)}
      >
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
    justify-content: center;
    gap: 10px 16px;
    /* Clear space above the first row, whose badges stick out above the cards */
    margin: 0 0 60px;
  }

  .list-filters {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  /* A pill like the chips beside it, outlined in You's sky blue */
  .search {
    width: 14rem;
    max-width: 100%;
    height: 2rem;
    padding: 0 14px;
    border: 2px solid var(--you-blue);
    border-radius: 999px;
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

  /*
   * Each chip has the colours of its section's badge, so the two are easy to match up. A shown
   * section's chip looks like the badge; a hidden one's is only outlined and dashed
   */
  .chip {
    --chip-background: var(--sea-blue);
    --chip-text: #ffffff;
    --chip-border: var(--sea-blue);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 2rem;
    padding: 0 12px 0 10px;
    border: 2px solid var(--chip-border);
    border-radius: 999px;
    background: var(--chip-background);
    color: var(--chip-text);
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      background-color 0.15s ease-out,
      color 0.15s ease-out;
  }

  /* Like the "behind" badge: sea blue, with You's sky blue as a halo */
  .chip.behind {
    background: linear-gradient(135deg, #1872b8, var(--sea-blue));
    box-shadow: 0 0 0 2px rgb(73 185 249 / 0.35);
  }

  /* Like the rewatch badge: sea blue on white, outlined in sky blue */
  .chip.rewatching {
    --chip-background: var(--surface);
    --chip-text: var(--text-accent);
    --chip-border: var(--you-blue);
  }

  /* Like the caught-up and completed badges */
  .chip.caught-up {
    --chip-background: var(--color-success);
    --chip-text: var(--color-success-content);
    --chip-border: var(--color-success);
  }

  /* Like the badges of anime without episode info */
  .chip.other {
    --chip-background: var(--color-neutral);
    --chip-text: var(--color-neutral-content);
    --chip-border: var(--color-neutral);
  }

  .chip[aria-pressed='false'] {
    border-color: var(--text-accent);
    border-style: dashed;
    background: var(--surface);
    box-shadow: none;
    color: var(--text-accent);
  }

  .chip:hover {
    filter: brightness(1.08);
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

  /* A tint of the chip's own text colour, so it suits every chip */
  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 18%, transparent);
    font-size: 0.75rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';

  import Menu from '#lib/components/Menu.svelte';

  type Props = {
    /** The trigger's accessible name, saying whose menu it is */
    label: string;
    /** The menu's items: list items that each hold a link */
    children: Snippet;
  };

  let { label, children }: Props = $props();
</script>

<!-- A "⋯" button at the end of a row of actions, holding the ones there's no room for -->
<Menu>
  {#snippet trigger({ open, props })}
    <button
      type="button"
      class="tw:btn tw:btn-sm tw:btn-square more-trigger"
      class:open
      {...props}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"
        ><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle
          cx="19"
          cy="12"
          r="1.75"
        /></svg
      >
    </button>
  {/snippet}
  {@render children()}
</Menu>

<style>
  .more-trigger {
    flex: none;
    color: var(--text-accent);
  }

  .open {
    border-color: var(--you-blue);
  }

  @media (pointer: coarse) {
    .more-trigger {
      width: 44px;
      height: 44px;
    }
  }
</style>

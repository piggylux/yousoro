<script lang="ts">
  import type { Snippet } from 'svelte';

  import Popover, { type PopoverTriggerProps } from '#lib/components/Popover.svelte';

  type Props = {
    /** The button that opens the menu, styled by its owner, with these props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
    /** The menu's items: list items holding links or buttons, and any headings between them */
    children: Snippet;
    /** Which edge of the trigger the menu lines up with, where there's room for it */
    align?: 'start' | 'end';
  };

  let { trigger, children, align = 'start' }: Props = $props();
</script>

<Popover {trigger} {align}>
  <ul class="items">
    {@render children()}
  </ul>
</Popover>

<style>
  .items {
    margin: 0;
    padding: 8px;
    list-style: none;
  }

  .items :global(a),
  .items :global(button) {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: var(--radius-control);
    color: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }

  .items :global(a:hover),
  .items :global(button:hover) {
    background: var(--you-blue-pale);
  }
</style>

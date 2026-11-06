<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import type { Snippet } from 'svelte';

  /** What ties the trigger to its menu, for it to spread on its button */
  type TriggerProps = {
    popovertarget: string;
    style: string;
    'aria-expanded': boolean;
    onfocusout: (event: FocusEvent) => void;
  };

  type Props = {
    /** The button that opens the menu, styled by its owner, with these props spread on it */
    trigger: Snippet<[{ open: boolean; props: TriggerProps }]>;
    /** The menu's items: list items holding links or buttons, and any headings between them */
    children: Snippet;
    /** Which edge of the trigger the menu lines up with, where there's room for it */
    align?: 'start' | 'end';
  };

  let { trigger, children, align = 'start' }: Props = $props();

  const id = $props.id();
  const anchor = `--${id}`;
  let menu = $state<HTMLElement>();
  // Set as the menu starts to open or close, so the trigger's state never lags a frame behind it
  let open = $state(false);

  // A link in the menu changes the page or its view, which the menu shouldn't stay open over
  afterNavigate(() => {
    if (menu?.matches(':popover-open')) menu.hidePopover();
  });

  /*
   * Moving focus away from both the trigger and the menu, by tabbing either way, leaves the menu
   * like a click elsewhere does, rather than leaving it open behind
   */
  function closeOnFocusLeave(event: FocusEvent) {
    const next = event.relatedTarget;
    if (!(next instanceof Element) || menu?.contains(next)) return;
    if (next.closest(`[popovertarget="${id}"]`)) return;
    if (menu?.matches(':popover-open')) menu.hidePopover();
  }
</script>

{@render trigger({
  open,
  props: {
    popovertarget: id,
    style: `anchor-name: ${anchor}`,
    'aria-expanded': open,
    onfocusout: closeOnFocusLeave,
  },
})}
<!--
  A popover closes on Escape or a click elsewhere, and returns focus to its trigger, without any
  script. It drops below the trigger where the browser can anchor it, and opens centred where not
-->
<div
  class="menu"
  class:align-end={align === 'end'}
  popover="auto"
  {id}
  bind:this={menu}
  style:position-anchor={anchor}
  onbeforetoggle={(event) => (open = event.newState === 'open')}
  onfocusout={closeOnFocusLeave}
>
  <ul>
    {@render children()}
  </ul>
</div>

<style>
  .menu {
    width: 220px;
    max-width: calc(100vw - 32px);
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    color: var(--text-heading);
  }

  @supports (position-area: block-end) {
    .menu {
      inset: auto;
      margin: 8px 0;
      position-area: block-end span-inline-end;
      position-try-fallbacks:
        flip-inline,
        flip-block,
        flip-block flip-inline;
    }

    .align-end {
      position-area: block-end span-inline-start;
    }
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .menu :global(a),
  .menu :global(button) {
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

  .menu :global(a:hover),
  .menu :global(button:hover) {
    background: var(--you-blue-pale);
  }
</style>

<script lang="ts" module>
  /** What ties the trigger to its panel, for it to spread on its button */
  export type PopoverTriggerProps = {
    popovertarget: string;
    style: string;
    'aria-expanded': boolean;
    onfocusout: (event: FocusEvent) => void;
  };
</script>

<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import type { Snippet } from 'svelte';

  type Props = {
    /** The button that opens the panel, styled by its owner, with these props spread on it */
    trigger: Snippet<[{ open: boolean; props: PopoverTriggerProps }]>;
    /** What the panel holds, laid out by its owner */
    children: Snippet;
    /** Which edge of the trigger the panel lines up with, where there's room for it */
    align?: 'start' | 'end';
    /** How wide the panel is; a menu's width when left out */
    width?: string;
    /** Wider than a menu: on a phone it takes the screen's width, less its gutters */
    wide?: boolean;
    /** Told as the panel starts to open or close */
    ontoggle?: (open: boolean) => void;
  };

  let { trigger, children, align = 'start', width, wide = false, ontoggle }: Props = $props();

  const id = $props.id();
  const anchor = `--${id}`;
  let panel = $state<HTMLElement>();
  // Set as the panel starts to open or close, so the trigger's state never lags a frame behind it
  let open = $state(false);

  /** Closes the panel, returning focus to its trigger when it was inside */
  export function close() {
    if (panel?.matches(':popover-open')) panel.hidePopover();
  }

  // A link in the panel changes the page or its view, which the panel shouldn't stay open over
  afterNavigate(close);

  /*
   * Moving focus away from both the trigger and the panel, by tabbing either way, leaves the panel
   * like a click elsewhere does, rather than leaving it open behind
   */
  function closeOnFocusLeave(event: FocusEvent) {
    const next = event.relatedTarget;
    if (!(next instanceof Element) || panel?.contains(next)) return;
    if (next.closest(`[popovertarget="${id}"]`)) return;
    close();
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
  class="popover"
  class:align-end={align === 'end'}
  class:wide
  popover="auto"
  {id}
  bind:this={panel}
  style:position-anchor={anchor}
  style:--popover-width={width}
  onbeforetoggle={(event) => {
    open = event.newState === 'open';
    ontoggle?.(open);
  }}
  onfocusout={closeOnFocusLeave}
>
  {@render children()}
</div>

<style>
  .popover {
    width: var(--popover-width, 220px);
    max-width: calc(100vw - 32px);
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
    color: var(--text-heading);
  }

  @supports (position-area: block-end) {
    .popover {
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

    /* Too wide to hang off a trigger on a phone without running off one side of the screen */
    @media (max-width: 600px) {
      .wide {
        position-area: block-end span-all;
        position-try-fallbacks: none;
        justify-self: stretch;
        width: auto;
        max-width: none;
        margin: 8px 16px;
      }
    }
  }
</style>

<script lang="ts">
  import { prefersReducedMotion } from 'svelte/motion';

  import SettingsForm from '#lib/components/SettingsForm.svelte';
  import type { Preferences } from '#lib/types/preferences.js';

  type Props = {
    preferences: Preferences;
    /** Whether the drawer is showing; set back to false when it closes */
    open: boolean;
  };

  let { preferences, open = $bindable() }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  // Only a press that starts on the dimmed page closes the drawer, not a drag that ends there
  let pressedBackdrop = false;

  // A modal dialog keeps focus inside the drawer, gives it back when it closes, and closes on Esc.
  // The close button and the backdrop set `open` themselves; Esc reports back through `onclose`
  $effect(() => {
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  });
</script>

<!-- Clicking the dimmed page beside the drawer closes it; Esc and the close button do too -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  class="drawer"
  class:animated={!prefersReducedMotion.current}
  bind:this={dialog}
  aria-labelledby="settings-drawer-title"
  onclose={() => (open = false)}
  onpointerdown={(event) => (pressedBackdrop = event.target === dialog)}
  onclick={(event) => {
    if (pressedBackdrop && event.target === dialog) open = false;
  }}
>
  <div class="panel">
    <div class="panel-header">
      <h2 id="settings-drawer-title" class="heading">Settings</h2>
      <button
        class="tw:btn tw:btn-ghost tw:btn-sm tw:btn-circle"
        aria-label="Close settings"
        onclick={() => (open = false)}
      >
        ✕
      </button>
    </div>
    <SettingsForm {preferences} shown={open} />
  </div>
</dialog>

<style>
  /* A full-height panel along the right edge, over the dimmed page */
  .drawer {
    width: min(26rem, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0 0 0 auto;
    padding: 0;
    border: none;
    background: var(--you-blue-pale);
    box-shadow: -8px 0 24px rgb(15 61 110 / 0.2);
  }

  /* The page behind stays where it is while the drawer is open */
  :global(:root:has(dialog.drawer[open])) {
    overflow: hidden;
  }

  .drawer::backdrop {
    background: rgb(15 61 110 / 0.35);
  }

  /* Slides in from the right as it opens, and back out as it closes */
  .animated {
    transition:
      translate 0.25s ease-out,
      overlay 0.25s allow-discrete,
      display 0.25s allow-discrete;
  }

  .drawer:not([open]) {
    translate: 100% 0;
  }

  @starting-style {
    .drawer[open] {
      translate: 100% 0;
    }
  }

  .animated::backdrop {
    transition:
      background-color 0.25s ease-out,
      overlay 0.25s allow-discrete,
      display 0.25s allow-discrete;
  }

  @starting-style {
    .drawer[open]::backdrop {
      background-color: rgb(15 61 110 / 0);
    }
  }

  .panel {
    height: 100%;
    padding: 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .heading {
    color: var(--navy);
    font-size: 1.35rem;
    font-weight: 800;
  }
</style>

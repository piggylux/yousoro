<script lang="ts">
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';

  // Shown once the page is scrolled past the first few hundred pixels
  const SHOW_AFTER = 400;

  let scrollY = $state(0);

  function backToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion.current ? 'instant' : 'smooth' });
    // The button disappears at the top, so focus moves to the page instead of being lost
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }
</script>

<svelte:window bind:scrollY />

{#if scrollY > SHOW_AFTER}
  <button
    class="back-to-top"
    transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
    onclick={backToTop}
    aria-label="Back to top"
    title="Back to top"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  </button>
{/if}

<style>
  /* Floats in the bottom corner, clear of a phone's home indicator */
  .back-to-top {
    position: fixed;
    right: max(20px, env(safe-area-inset-right));
    bottom: max(20px, env(safe-area-inset-bottom));
    z-index: 20;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text-heading);
    box-shadow: var(--shadow-popover);
    cursor: pointer;
    transition: background-color 0.2s ease-out;
    border: 1px solid var(--border-subtle);
  }

  .back-to-top:hover,
  .back-to-top:focus-visible {
    background: var(--you-blue-pale);
  }

  .back-to-top:focus-visible {
    outline: 2px solid var(--you-blue);
    outline-offset: 3px;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>

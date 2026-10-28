<script lang="ts">
  let {
    label,
    onclick,
  }: {
    label: string;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class="close-button" aria-label={label} title={label} {onclick}>
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m6 6 12 12M6 18 18 6" />
  </svg>
</button>

<style>
  .close-button {
    display: grid;
    place-items: center;
    flex: none;
    align-self: flex-start;
    box-sizing: border-box;
    width: 44px;
    min-width: 44px;
    height: 44px;
    margin: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-accent);
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  .close-button:hover {
    background: var(--surface-muted);
    color: var(--text-heading);
  }

  .close-button:active {
    background: var(--border-subtle);
    color: var(--text-heading);
  }

  .close-button:focus-visible {
    outline: 2px solid var(--you-blue);
    outline-offset: 2px;
  }

  svg {
    display: block;
  }

  @media (prefers-reduced-motion: reduce) {
    .close-button {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import { tick } from 'svelte';

  import { shareLink } from '#lib/share.js';

  type Props = {
    /** The page to share, as an absolute URL */
    url: string;
    /** Its title, for the share sheet */
    title: string;
    /** What's shared, completing the button's accessible name: "Share {subject}" */
    subject: string;
  };

  let { url, title, subject }: Props = $props();

  // Feedback once the link is copied or couldn't be, shown on the button for a moment
  let copied = $state<'copied' | 'failed' | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));

  // A second tap while the share sheet is open would fail, and fall back to copying the link
  let sharing = false;

  async function share() {
    if (sharing) return;
    sharing = true;
    try {
      const outcome = await shareLink(
        { title, url },
        {
          share: navigator.share ? (data) => navigator.share(data) : undefined,
          clipboard: navigator.clipboard,
          touch: matchMedia('(pointer: coarse)').matches,
        }
      );
      clearTimeout(timer);
      // Cleared first, so copying again while "Copied" still shows is announced again
      copied = null;
      await tick();
      copied = outcome === 'copied' || outcome === 'failed' ? outcome : null;
      if (copied) timer = setTimeout(() => (copied = null), 2500);
    } finally {
      sharing = false;
    }
  }
</script>

<button type="button" class="share-button" onclick={share}>
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#if copied === 'copied'}
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    {:else}
      <path
        d="M12 15V3.5M8 7.5l4-4 4 4M8 10.5H6.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2H16"
      />
    {/if}
  </svg>
  {#if copied === 'copied'}
    Copied
  {:else if copied === 'failed'}
    Couldn't copy
  {:else}
    Share<span class="tw:sr-only">&nbsp;{subject}</span>
  {/if}
</button>
<span class="tw:sr-only" role="status">
  {copied === 'copied' ? 'Link copied' : copied === 'failed' ? "Couldn't copy the link" : ''}
</span>

<style>
  /*
   * A quiet action beside a heading: blue text rather than a filled button. It fits the heading's
   * line for a mouse, and grows to a 44px target on touch screens instead of overlapping the line
   * below
   */
  .share-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    margin-block: -1px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--action);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  .share-button:hover {
    background: var(--you-blue-pale);
    color: var(--action-hover);
  }

  .share-button:active {
    border-color: var(--border-subtle);
  }

  @media (pointer: coarse) {
    .share-button {
      min-height: 44px;
      margin-block: 0;
    }
  }

  svg {
    display: block;
    flex: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .share-button {
      transition: none;
    }
  }
</style>

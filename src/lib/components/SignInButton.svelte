<script lang="ts">
  import { page } from '$app/state';

  import { startAniListSignIn } from '#lib/anilist-auth.js';
  import { malSignInPath } from '#lib/myanimelist-auth.js';
  import { DOMAIN_NAMES, type Domain } from '#lib/types/domain.js';

  type Props = {
    /** The service to sign in with */
    service?: Domain;
    /** Where to come back to after signing in */
    redirectTo?: string;
    class?: string;
    compact?: boolean;
    /** Neutral rather than blue, beside another sign-in button */
    secondary?: boolean;
  };

  let {
    service = 'anilist',
    redirectTo = page.url.pathname,
    class: className = '',
    compact = false,
    secondary = false,
  }: Props = $props();

  const label = $derived(`Sign in with ${DOMAIN_NAMES[service]}`);
</script>

{#snippet content()}
  <span>{compact ? 'Sign in' : label}</span>
  {#if !compact}
    <span class="arrow" aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </span>
  {/if}
{/snippet}

{#if service === 'anilist'}
  <button
    type="button"
    class="sign-in {className}"
    class:compact
    class:secondary
    aria-label={compact ? label : undefined}
    onclick={() => startAniListSignIn(redirectTo)}
  >
    {@render content()}
  </button>
{:else}
  <!-- The server starts this sign-in, so the link leaves the app rather than navigating within it -->
  <a
    class="sign-in {className}"
    class:compact
    class:secondary
    aria-label={compact ? label : undefined}
    href={malSignInPath(redirectTo)}
    data-sveltekit-reload
  >
    {@render content()}
  </a>
{/if}

<style>
  .sign-in {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-height: 44px;
    max-width: 100%;
    padding: 10px 18px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: var(--action);
    color: var(--action-content);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 150ms ease;
  }
  .sign-in:hover {
    background: var(--action-hover);
  }
  .arrow {
    display: flex;
  }
  .arrow svg {
    transition: transform 150ms ease;
  }
  .sign-in:hover .arrow svg {
    transform: translateX(2px);
  }
  .compact {
    flex-shrink: 0;
    padding: 8px 14px;
    white-space: nowrap;
  }
  .compact,
  .secondary {
    border-color: var(--border-subtle);
    background: var(--surface);
    color: var(--text-heading);
  }
  .compact:hover,
  .secondary:hover {
    background: var(--surface-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .sign-in,
    .arrow svg {
      transition: none;
    }

    .sign-in:hover .arrow svg {
      transform: none;
    }
  }
</style>

<script lang="ts">
  import { page } from '$app/state';

  import { getAuthorizeUrl, PENDING_SIGN_IN_KEY } from '#lib/anilist-auth.js';

  type Props = {
    /** Where to come back to after signing in */
    redirectTo?: string;
    class?: string;
    compact?: boolean;
  };

  let { redirectTo = page.url.pathname, class: className = '', compact = false }: Props = $props();

  function signIn() {
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ state, redirectTo }));
    } catch {
      // Without sessionStorage the callback can't confirm this browser started the sign-in
      alert('Signing in needs browser storage, which is blocked in this window.');
      return;
    }
    location.assign(getAuthorizeUrl(state));
  }
</script>

<button
  type="button"
  class="sign-in {className}"
  class:compact
  aria-label={compact ? 'Sign in with AniList' : undefined}
  onclick={signIn}
>
  <span>{compact ? 'Sign in' : 'Sign in with AniList'}</span>
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
</button>

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
    border-color: var(--border-subtle);
    background: var(--surface);
    color: var(--text-heading);
    white-space: nowrap;
  }
  .compact:hover {
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

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
    min-height: 44px;
    max-width: 100%;
    padding: 10px 18px;
    border: 1px solid light-dark(#2778b5, #83cfff);
    border-radius: 10px;
    background: light-dark(var(--sea-blue), var(--you-blue));
    color: light-dark(#ffffff, #0f304f);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.22),
      0 2px 5px rgb(15 48 79 / 0.15);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
    transition:
      background-color 0.15s ease-out,
      translate 0.15s ease-out,
      box-shadow 0.15s ease-out;
  }

  .arrow {
    display: grid;
    place-items: center;
    flex: none;
    margin-left: 14px;
    padding-left: 12px;
    border-left: 1px solid currentColor;
    border-color: color-mix(in srgb, currentColor 25%, transparent);
  }

  .arrow svg {
    transition: translate 0.15s ease-out;
  }

  .sign-in:hover {
    background: light-dark(var(--navy), #9fdcff);
  }

  .sign-in:focus-visible {
    outline: 2px solid var(--text-heading);
    outline-offset: 3px;
  }

  .sign-in:active {
    background: light-dark(#0b2e53, #7dccfb);
    translate: 0 0;
    box-shadow: inset 0 1px 3px rgb(15 48 79 / 0.15);
  }

  @media (hover: hover) {
    .sign-in:not(.compact):hover {
      translate: 0 -1px;
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.22),
        0 4px 8px rgb(15 48 79 / 0.2);
    }

    .sign-in:hover .arrow svg {
      translate: 2px 0;
    }
  }

  .sign-in:not(.compact):active {
    translate: 0 0;
  }

  .compact {
    flex-shrink: 0;
    max-width: none;
    padding: 8px 14px;
    border-color: var(--border-subtle);
    background: transparent;
    box-shadow: none;
    color: var(--text-accent);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .compact:hover,
  .compact:active {
    background: var(--you-blue-pale);
  }

  @media (prefers-reduced-motion: reduce) {
    .sign-in,
    .arrow svg {
      transition: none;
    }

    .sign-in:not(.compact):hover,
    .sign-in:hover .arrow svg {
      translate: none;
    }
  }
</style>

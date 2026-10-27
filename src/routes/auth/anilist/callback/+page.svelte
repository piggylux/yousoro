<script lang="ts">
  import { goto, replaceState } from '$app/navigation';
  import { onMount } from 'svelte';

  import { PENDING_SIGN_IN_KEY } from '#lib/anilist-auth.js';

  let errorMessage = $state<string | null>(null);

  onMount(async () => {
    // AniList puts the token in the URL fragment, which browsers never send to servers
    const params = new URLSearchParams(location.hash.slice(1));
    // Keep the token out of the address bar and the browser history
    replaceState(location.pathname, {});

    let pending: { state: string; redirectTo: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_SIGN_IN_KEY) ?? 'null');
      sessionStorage.removeItem(PENDING_SIGN_IN_KEY);
    } catch {
      pending = null;
    }

    const token = params.get('access_token');
    const state = params.get('state');
    // Only accept a token for the sign-in this browser started, matched by its random state, so a
    // link carrying someone else's token can't sign you in to their account
    if (!pending || !token || state !== pending.state) {
      errorMessage = 'Sign-in expired or was started elsewhere, please try again';
      return;
    }

    const response = await fetch('/auth/anilist/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        expiresIn: Number(params.get('expires_in')),
        redirectTo: pending.redirectTo,
      }),
    });
    if (!response.ok) {
      errorMessage = 'AniList sign-in failed, please try again';
      return;
    }

    const { redirectTo }: { redirectTo: string } = await response.json();
    await goto(redirectTo, { replaceState: true, invalidateAll: true });
  });
</script>

<section class="tw:flex tw:flex-col tw:items-center tw:gap-4">
  {#if errorMessage}
    <p class="tw:text-error" role="alert">{errorMessage}</p>
    <a class="tw:btn" href="/home">Back to home</a>
  {:else}
    <span class="tw:loading tw:loading-ring tw:loading-lg"></span>
    <p>Signing in with AniList…</p>
  {/if}
</section>

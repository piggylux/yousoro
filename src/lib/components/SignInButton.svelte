<script lang="ts">
  import { page } from '$app/state';

  import { getAuthorizeUrl, PENDING_SIGN_IN_KEY } from '#lib/anilist-auth.js';

  type Props = {
    /** Where to come back to after signing in */
    redirectTo?: string;
    class?: string;
  };

  let { redirectTo = page.url.pathname, class: className = 'tw:btn tw:btn-primary' }: Props =
    $props();

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

<button class={className} onclick={signIn}>Sign in with AniList</button>

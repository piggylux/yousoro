// Sign-in uses AniList's implicit grant, which needs only a client ID and no secret
import { ANILIST_CLIENT_ID } from '$app/env/public';

const AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';

export const CALLBACK_PATH = '/auth/anilist/callback';

/** sessionStorage key marking a sign-in this browser started */
export const PENDING_SIGN_IN_KEY = 'anilist_sign_in';

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: ANILIST_CLIENT_ID,
    response_type: 'token',
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** Sends the browser to AniList to sign in, then back to `redirectTo` */
export function startAniListSignIn(redirectTo: string) {
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

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

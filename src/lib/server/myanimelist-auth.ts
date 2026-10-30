import { randomBytes } from 'node:crypto';

import { MAL_CLIENT_ID, MAL_CLIENT_SECRET } from '$app/env/private';
import type { Cookies } from '@sveltejs/kit';

import { getViewer, MalTokenError } from '#lib/server/myanimelist-client.js';
import { safeRedirectPath } from '#lib/server/redirect.js';
import { isBearerToken, setMalSession, type MalSession } from '#lib/server/session.js';

const AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const CALLBACK_PATH = '/auth/myanimelist/callback';

/** The sign-in this browser started, kept until MyAnimeList sends it back to the callback */
const SIGN_IN_COOKIE = 'mal_sign_in';
const SIGN_IN_PATH = '/auth/myanimelist';

/** Whether this site has a MyAnimeList client, without which its sign-in and lists are off */
export const MAL_ENABLED = Boolean(MAL_CLIENT_ID && MAL_CLIENT_SECRET);

/** Thrown when a sign-in can't finish, with a message for the user */
export class MalSignInError extends Error {}

/**
 * Starts a sign-in and returns the MyAnimeList page to send the browser to. MyAnimeList hands back a
 * code rather than a token, which the server exchanges with the client secret. The state and the
 * PKCE verifier stay in an httpOnly cookie, so only this browser can finish this sign-in. MyAnimeList
 * only supports the "plain" PKCE method, where the challenge is the verifier itself
 */
export function startSignIn(cookies: Cookies, origin: string, redirectTo: string): string {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  cookies.set(SIGN_IN_COOKIE, JSON.stringify({ state, verifier, redirectTo }), {
    path: SIGN_IN_PATH,
    httpOnly: true,
    // Lax still sends it when MyAnimeList redirects back, a top-level navigation
    sameSite: 'lax',
    maxAge: 10 * 60,
  });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: MAL_CLIENT_ID!,
    state,
    redirect_uri: origin + CALLBACK_PATH,
    code_challenge: verifier,
    code_challenge_method: 'plain',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function readPendingSignIn(raw: string | undefined) {
  try {
    const pending = JSON.parse(raw ?? 'null');
    if (typeof pending?.state === 'string' && typeof pending.verifier === 'string') {
      return {
        state: pending.state as string,
        verifier: pending.verifier as string,
        redirectTo: safeRedirectPath(pending.redirectTo),
      };
    }
  } catch {
    // An unreadable cookie is no sign-in at all
  }
  return null;
}

/**
 * Finishes the sign-in MyAnimeList redirected back with: checks it's the one this browser started,
 * exchanges the code for tokens and finds out whose they are. Returns where to go next
 */
export async function finishSignIn(
  cookies: Cookies,
  url: URL
): Promise<{ session: MalSession; redirectTo: string }> {
  const pending = readPendingSignIn(cookies.get(SIGN_IN_COOKIE));
  cookies.delete(SIGN_IN_COOKIE, { path: SIGN_IN_PATH });

  // Matched by its random state, so a link carrying someone else's code can't sign you in to
  // their account
  if (!pending || url.searchParams.get('state') !== pending.state) {
    throw new MalSignInError('Sign-in expired or was started elsewhere, please try again');
  }
  // As when the user chose not to allow access
  if (url.searchParams.has('error')) throw new MalSignInError('MyAnimeList sign-in was cancelled');
  const code = url.searchParams.get('code');
  if (!code) throw new MalSignInError('MyAnimeList sign-in failed, please try again');

  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    code_verifier: pending.verifier,
    redirect_uri: url.origin + CALLBACK_PATH,
  });
  const user = await getViewer(tokens.token);
  return { session: { ...tokens, user }, redirectTo: pending.redirectTo };
}

/** Asks MyAnimeList's token endpoint for tokens, authenticating with the client secret */
async function requestTokens(params: Record<string, string>): Promise<Omit<MalSession, 'user'>> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: MAL_CLIENT_ID!,
      client_secret: MAL_CLIENT_SECRET!,
      ...params,
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // The code or refresh token was refused: expired, already used, or revoked
    if (response.status === 400 || response.status === 401) {
      throw new MalTokenError(`MyAnimeList refused the ${params.grant_type} grant`);
    }
    throw new Error(`MyAnimeList token endpoint returned ${response.status}`);
  }
  const expiresIn = Number(body?.expires_in);
  if (!isBearerToken(body?.access_token) || !isBearerToken(body?.refresh_token)) {
    throw new Error('MyAnimeList sent tokens in an unexpected format');
  }
  return {
    token: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };
}

/** Gets new tokens with the refresh token, and keeps them in the cookie */
async function renew(
  event: { cookies: Cookies; locals: App.Locals },
  session: MalSession
): Promise<MalSession> {
  const tokens = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });
  const renewed = { ...session, ...tokens };
  setMalSession(event.cookies, renewed);
  event.locals.malSession = renewed;
  return renewed;
}

/**
 * Runs `use` with the signed-in user's MyAnimeList token, renewed first when it has expired. A token
 * can also be revoked early, as when another request renewed it, so one MyAnimeList rejects is
 * renewed once and tried again. Throws MalTokenError only when the sign-in can't be renewed; the
 * caller then signs the user out of MyAnimeList
 */
export async function withMalToken<T>(
  event: { cookies: Cookies; locals: App.Locals },
  use: (token: string) => Promise<T>
): Promise<T> {
  const session = event.locals.malSession;
  if (!session) throw new MalTokenError('Not signed in with MyAnimeList');
  if (session.expiresAt <= Date.now() + 60_000) {
    return useRenewed(use, (await renew(event, session)).token);
  }
  try {
    return await use(session.token);
  } catch (err) {
    if (!(err instanceof MalTokenError)) throw err;
  }
  return useRenewed(use, (await renew(event, session)).token);
}

/**
 * A token rejected just after it was renewed doesn't mean the sign-in is over: another request may
 * have renewed it again meanwhile, which revokes this one. So it fails without signing anyone out
 */
async function useRenewed<T>(use: (token: string) => Promise<T>, token: string): Promise<T> {
  try {
    return await use(token);
  } catch (err) {
    if (!(err instanceof MalTokenError)) throw err;
    throw new Error('MyAnimeList rejected a token it had just renewed', { cause: err });
  }
}

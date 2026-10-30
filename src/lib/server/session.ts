import type { Cookies } from '@sveltejs/kit';

import { type CookieFormat, readVersioned, writeVersioned } from '#lib/server/versioned-cookie.js';
import type { SessionUser } from '#lib/types/session-user.js';

export type Session = {
  /** The user's AniList access token */
  token: string;
  user: SessionUser;
};

const SESSION_COOKIE = 'session';
// Limit browser cookie retention; this cannot revoke a copied token or enforce token expiry.
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;

/**
 * AniList access tokens are JWTs: three base64url parts joined by dots. Anything else is refused, so
 * malformed values cannot inject Authorization headers. AniList validates token authenticity.
 */
export function isAccessToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 4096 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  );
}

/** Only https images, since the URL ends up in an <img> */
function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

const SESSION_FORMAT: CookieFormat<Session> = {
  version: 1,
  parse: (data) => {
    const session = data as { token?: unknown; user?: Record<string, unknown> } | null;
    if (
      !isAccessToken(session?.token) ||
      !Number.isInteger(session.user?.id) ||
      typeof session.user?.name !== 'string'
    ) {
      return null;
    }
    return {
      token: session.token,
      user: {
        id: session.user.id as number,
        name: session.user.name,
        avatarUrl: httpsUrlOrNull(session.user.avatarUrl),
      },
    };
  },
  migrations: {
    // Sessions from before versioning are already in the version 1 shape
    0: (data) => data,
  },
};

// The cookie holds the user's own token in plain JSON. Scripts can't read it (httpOnly) and it only
// travels over HTTPS in production. It isn't encrypted or signed, since that would need a server
// secret, and nothing depends on trusting its contents: AniList applies every update to the
// token's owner, and `user` only decides which buttons are shown.
export function getSession(cookies: Cookies): Session | null {
  return readVersioned(cookies.get(SESSION_COOKIE), SESSION_FORMAT);
}

/** `tokenLifetimeSeconds` is how long AniList says the token lasts; sessions never last longer. */
export function setSession(cookies: Cookies, session: Session, tokenLifetimeSeconds: number) {
  cookies.set(SESSION_COOKIE, writeVersioned(session, SESSION_FORMAT), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: Math.max(0, Math.min(tokenLifetimeSeconds, MAX_SESSION_SECONDS)),
  });
}

export function clearSession(cookies: Cookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * A MyAnimeList sign-in, kept in its own cookie beside AniList's, so the two tokens never share
 * the browser's size limit for one cookie. MyAnimeList access tokens expire, unlike AniList's, so
 * the refresh token is kept to get a new one.
 */
export type MalSession = Session & {
  refreshToken: string;
  /** When the access token expires, as Unix time in ms */
  expiresAt: number;
};

const MAL_SESSION_COOKIE = 'session_mal';
// MyAnimeList refresh tokens last a month, and each refresh issues a new one
const MAL_SESSION_SECONDS = 30 * 24 * 60 * 60;

/**
 * MyAnimeList doesn't say its tokens are JWTs, so any OAuth bearer token is accepted (RFC 6750).
 * Its characters can't break a header or a form body.
 */
export function isBearerToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && /^[A-Za-z0-9\-._~+/]+=*$/.test(value);
}

const MAL_SESSION_FORMAT: CookieFormat<MalSession> = {
  version: 1,
  parse: (data) => {
    const session = data as Record<string, unknown> & { user?: Record<string, unknown> };
    if (
      !isBearerToken(session?.token) ||
      !isBearerToken(session.refreshToken) ||
      !Number.isFinite(session.expiresAt) ||
      !Number.isInteger(session.user?.id) ||
      typeof session.user?.name !== 'string'
    ) {
      return null;
    }
    return {
      token: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt as number,
      user: {
        id: session.user.id as number,
        name: session.user.name,
        avatarUrl: httpsUrlOrNull(session.user.avatarUrl),
      },
    };
  },
};

// Kept like the AniList cookie, for the same reasons. The refresh token makes it worth more, so it
// stays httpOnly and is only ever sent to MyAnimeList's token endpoint.
export function getMalSession(cookies: Cookies): MalSession | null {
  return readVersioned(cookies.get(MAL_SESSION_COOKIE), MAL_SESSION_FORMAT);
}

export function setMalSession(cookies: Cookies, session: MalSession) {
  cookies.set(MAL_SESSION_COOKIE, writeVersioned(session, MAL_SESSION_FORMAT), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAL_SESSION_SECONDS,
  });
}

export function clearMalSession(cookies: Cookies) {
  cookies.delete(MAL_SESSION_COOKIE, { path: '/' });
}

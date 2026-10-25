import type { Cookies } from '@sveltejs/kit';

import { type CookieFormat, readVersioned, writeVersioned } from '#lib/server/versioned-cookie.js';
import type { SessionUser } from '#lib/types/session-user.js';

export type Session = {
  /** The user's AniList access token */
  token: string;
  user: SessionUser;
};

const SESSION_COOKIE = 'session';
// AniList tokens last a year, but signing out can't revoke them, so sessions stop sooner
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;

/**
 * AniList access tokens are JWTs: three base64url parts joined by dots. Anything else is refused, so
 * a hand-edited value never reaches the Authorization header sent to AniList.
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

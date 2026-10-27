import { error, json, type RequestEvent } from '@sveltejs/kit';

import {
  AniListRateLimitError,
  AniListTokenError,
  getFriendsWatching,
  getSharedAnime,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

async function read(event: RequestEvent, ids?: number[]) {
  const session = event.locals.session;
  if (!session) error(401, 'Sign in to see friends watching');
  try {
    const limit = await takeClientLimit(event.getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    const result = ids
      ? await getFriendsWatching(session.token, session.user.id, ids)
      : await getSharedAnime(session.token, session.user.id);
    if (!Array.isArray(result) && result.retryAfter) event.locals.retryAfter = result.retryAfter;
    return json(result);
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      event.locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    if (err instanceof AniListTokenError) {
      clearSession(event.cookies);
      event.locals.session = null;
      error(401, 'Your AniList sign-in expired, please sign in again');
    }
    console.error('Could not load friends watching', err);
    error(502, 'Friends watching is unavailable, please try again');
  }
}

export async function POST(event: RequestEvent) {
  if (!event.locals.session) error(401, 'Sign in to see friends watching');
  const body = await event.request.json().catch(() => null);
  const ids: unknown = body?.mediaIds;
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) ||
    new Set(ids).size !== ids.length
  ) {
    error(400, 'Provide up to 500 unique positive AniList media IDs');
  }
  return read(event, ids);
}

export async function GET(event: RequestEvent) {
  return read(event);
}

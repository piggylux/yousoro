import { error, json, type RequestEvent } from '@sveltejs/kit';

import {
  AniListRateLimitError,
  AniListTokenError,
  getFriendActivity,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

// Far more pages than anyone scrolls through in a dropdown
const MAX_PAGE = 50;

/**
 * A page of what the people the signed-in user follows on AniList did to their anime lists, newest
 * first: `?page=2`
 */
export async function GET(event: RequestEvent) {
  const session = event.locals.session;
  if (!session) error(401, 'Sign in with AniList to see what your friends are watching');
  const param = event.url.searchParams.get('page');
  const page = param === null ? 1 : Number(param);
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    error(400, `Ask for a page from 1 to ${MAX_PAGE}`);
  }
  try {
    const limit = await takeClientLimit(event.getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    const result = await getFriendActivity(session.token, { page, viewerId: session.user.id });
    // The last page asked for here, so nothing offers one past it
    return json(page === MAX_PAGE ? { ...result, hasNextPage: false } : result);
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
    console.error('Could not load friend activity', err);
    error(502, "Friends' activity is unavailable, please try again");
  }
}

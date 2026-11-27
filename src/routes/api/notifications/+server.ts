import { error, json, type RequestEvent } from '@sveltejs/kit';

import {
  AniListRateLimitError,
  AniListTokenError,
  getNotifications,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

// Far more pages than anyone scrolls through; AniList keeps a few months of notifications
const MAX_PAGE = 100;

async function read(event: RequestEvent, page: number, markRead: boolean) {
  const session = event.locals.session;
  if (!session) error(401, 'Sign in with AniList to see your notifications');
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
    error(400, `Ask for a page from 1 to ${MAX_PAGE}`);
  }
  try {
    const limit = await takeClientLimit(event.getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    const result = await getNotifications(session.token, { page, markRead });
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
    console.error('Could not load notifications', err);
    error(502, 'Notifications are unavailable, please try again');
  }
}

/** A page of the signed-in user's AniList notifications, newest first: `?page=2` */
export async function GET(event: RequestEvent) {
  const page = event.url.searchParams.get('page');
  return read(event, page === null ? 1 : Number(page), false);
}

/**
 * The first page, marking the notifications read on AniList, as opening them there does. JSON only,
 * since it changes something: another site can't send JSON here without the browser asking first,
 * and this route never allows it
 */
export async function POST(event: RequestEvent) {
  if (!event.locals.session) error(401, 'Sign in with AniList to see your notifications');
  if (event.request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    error(415, 'Expected JSON');
  }
  return read(event, 1, true);
}

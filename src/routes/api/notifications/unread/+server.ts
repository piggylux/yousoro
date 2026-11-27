import { error, json } from '@sveltejs/kit';

import {
  AniListRateLimitError,
  AniListTokenError,
  getUnreadNotificationCount,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import type { RequestHandler } from './$types';

/**
 * How many AniList notifications the signed-in user hasn't seen (`{ unread }`), for the bell in the
 * header. Asked at most about once a minute, and nobody waits on it: its read gives way to everything
 * else, and when AniList is busy the bell keeps the count it had
 */
export const GET: RequestHandler = async ({ locals, getClientAddress }) => {
  if (!locals.session) error(401, 'Sign in with AniList to see your notifications');
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) {
    locals.retryAfter = limit.retryAfter;
    error(429, 'Too many requests, please try again shortly');
  }

  try {
    return json({ unread: await getUnreadNotificationCount(locals.session.token) });
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    // A sign-in that can't be renewed is left for the page's own reads and saves to report, rather
    // than signing anyone out from a check they didn't ask for
    if (err instanceof AniListTokenError) return new Response(null, { status: 204 });
    console.error('Could not count unread notifications', err);
    error(502, 'The notification count is unavailable, please try again');
  }
};

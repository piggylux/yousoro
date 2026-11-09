import { error, json } from '@sveltejs/kit';

import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { getListedIds, MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearMalSession } from '#lib/server/session.js';

import type { RequestHandler } from './$types';

/**
 * The MyAnimeList ids of the anime on each of the signed-in user's own lists other than Watching:
 * `{ listedIds }`. Asked once as the anime search opens on a MyAnimeList list, so it can say where
 * the anime it finds are. An AniList list has them already, as its own read brings them along
 */
export const GET: RequestHandler = async (event) => {
  if (!event.locals.malSession) error(401, 'Sign in with MyAnimeList to see your lists');
  const limit = await takeClientLimit(event.getClientAddress(), 'read');
  if (!limit.allowed) {
    event.locals.retryAfter = limit.retryAfter;
    error(429, 'Too many requests, please try again shortly');
  }
  try {
    return json({ listedIds: await withMalToken(event, getListedIds) });
  } catch (err) {
    if (err instanceof MalRateLimitError) {
      event.locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    if (err instanceof MalTokenError) {
      clearMalSession(event.cookies);
      event.locals.malSession = null;
      error(401, 'Your MyAnimeList sign-in expired, please sign in again');
    }
    console.error('Could not read the MyAnimeList lists', err);
    error(502, "MyAnimeList didn't share your lists, please try again");
  }
};

import { error, json } from '@sveltejs/kit';

import { AniListRateLimitError, AniListTokenError } from '#lib/server/anilist-client.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import { MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { getSyncPlan } from '#lib/server/sync.js';
import { differenceKey, SYNC_ENABLED } from '#lib/sync.js';

import type { RequestHandler } from './$types';

/**
 * How the signed-in user's AniList and MyAnimeList lists differ, as a short key for each anime
 * (`{ keys }`), so their own list can say when the lists drift apart, as after a change on one of
 * the sites. Asked at most every few hours from the list, and nobody waits on it: its reads give way
 * to everything else, and when a service is busy it's simply asked again on a later visit
 */
export const GET: RequestHandler = async (event) => {
  const { locals, getClientAddress } = event;
  if (!SYNC_ENABLED || !MAL_ENABLED) error(404, 'Syncing lists is not available on this site');
  if (!locals.session || !locals.malSession) error(401, 'Sign in to both services to compare them');
  const limit = await takeClientLimit(getClientAddress(), 'read', 2);
  if (!limit.allowed) {
    locals.retryAfter = limit.retryAfter;
    error(429, 'Too many requests, please try again shortly');
  }

  try {
    const { items } = await getSyncPlan(event, 'spare');
    return json({ keys: items.map(differenceKey) });
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    // A sign-in that can't be renewed is left for the list's own reads and saves to report, rather
    // than signing anyone out from a check they didn't ask for
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      return new Response(null, { status: 204 });
    }
    console.error('Could not compare the lists', err);
    error(502, "The lists couldn't be compared, please try again");
  }
};

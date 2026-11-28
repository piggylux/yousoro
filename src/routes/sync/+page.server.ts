import { error } from '@sveltejs/kit';

import { STILL_READING, stillReading, within } from '#lib/first-load.js';
import { AniListRateLimitError, AniListTokenError } from '#lib/server/anilist-client.js';
import {
  MAL_ENABLED,
  MalRenewalDeferredError,
  renewMalTokenIfExpiring,
} from '#lib/server/myanimelist-auth.js';
import { MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { getSyncPlan } from '#lib/server/sync.js';
import { SYNC_ENABLED } from '#lib/sync.js';

import type { PageServerLoad } from './$types';

/**
 * What the AniList and MyAnimeList lists see differently, for the user to review before syncing.
 * A first load waits a moment for both lists, then answers with the page in outline while the
 * browser reads them. The MyAnimeList sign-in is renewed before that wait when it's about to
 * expire, and never during it: a read that outlasts the page couldn't send the renewed token's
 * cookie, and would leave the user signed out. One that needs renewing is left to the browser's read
 */
export const load: PageServerLoad = async (event) => {
  const { locals, cookies, getClientAddress, isDataRequest } = event;
  if (!SYNC_ENABLED || !MAL_ENABLED) error(404, 'Syncing lists is not available on this site');
  if (!locals.session || !locals.malSession) return { linked: false as const };

  let plan;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read', 2);
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    if (isDataRequest) plan = await getSyncPlan(event, 'optional');
    else {
      await renewMalTokenIfExpiring(event);
      plan = await within(getSyncPlan(event, 'optional', { renew: false }));
    }
  } catch (err) {
    if (err instanceof MalRenewalDeferredError) plan = STILL_READING;
    else if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
    }
    // A sign-in that can't be renewed: the page asks to sign in again
    else if (err instanceof AniListTokenError) {
      clearSession(cookies);
      locals.session = null;
      return { linked: false as const };
    } else if (err instanceof MalTokenError) {
      clearMalSession(cookies);
      locals.malSession = null;
      return { linked: false as const };
    } else throw err;
  }
  if (plan === STILL_READING) stillReading('AniList or MyAnimeList', 'Your lists');
  return { linked: true as const, ...plan };
};

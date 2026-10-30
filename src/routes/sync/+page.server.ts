import { error } from '@sveltejs/kit';

import { AniListRateLimitError, AniListTokenError } from '#lib/server/anilist-client.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import { MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { getSyncPlan } from '#lib/server/sync.js';
import { SYNC_ENABLED } from '#lib/sync.js';

import type { PageServerLoad } from './$types';

/** What the AniList and MyAnimeList lists see differently, for the user to review before syncing */
export const load: PageServerLoad = async (event) => {
  const { locals, cookies, getClientAddress } = event;
  if (!SYNC_ENABLED || !MAL_ENABLED) error(404, 'Syncing lists is not available on this site');
  if (!locals.session || !locals.malSession) return { linked: false as const };

  try {
    const limit = await takeClientLimit(getClientAddress(), 'read', 2);
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    return { linked: true as const, ...(await getSyncPlan(event)) };
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
    }
    // A sign-in that can't be renewed: the page asks to sign in again
    if (err instanceof AniListTokenError) {
      clearSession(cookies);
      locals.session = null;
      return { linked: false as const };
    }
    if (err instanceof MalTokenError) {
      clearMalSession(cookies);
      locals.malSession = null;
      return { linked: false as const };
    }
    throw err;
  }
};

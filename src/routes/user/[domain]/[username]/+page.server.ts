import { error, fail, type RequestEvent } from '@sveltejs/kit';

import { AniListTokenError, AniListRateLimitError, saveEntry } from '#lib/server/anilist-client.js';
import { parseEntryUpdate } from '#lib/server/entry-update.js';
import { loadAnimePage } from '#lib/server/list-page.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession, type Session } from '#lib/server/session.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** Browser navigation defers the read so the viewer-scoped memory cache can serve it. */
export const load: import('./$types').PageServerLoad = async (event) => {
  if (!isDomain(event.params.domain)) error(404, `Unknown domain: ${event.params.domain}`);
  if (event.isDataRequest) return { deferred: true as const, username: event.params.username };
  return loadAnimePage(event);
};

/**
 * Runs an update on the signed-in user's own AniList list, whatever list the page shows, and
 * turns what can go wrong into a message for the card
 */
async function updateOwnList<T>(
  { params, locals, cookies }: Pick<RequestEvent, 'params' | 'locals' | 'cookies'>,
  update: (session: Session) => Promise<T>
) {
  if (params.domain !== 'anilist') {
    return fail(400, { message: 'Only AniList lists can be updated' });
  }
  if (!locals.session) {
    return fail(401, { message: 'Sign in with AniList to update your list' });
  }
  try {
    return await update(locals.session);
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      return fail(429, { message: err.message });
    }
    console.error(err);
    if (err instanceof AniListTokenError) {
      clearSession(cookies);
      return fail(401, { message: 'Your AniList sign-in expired, please sign in again' });
    }
    return fail(502, { message: 'AniList rejected the update, please try again' });
  }
}

export const actions: Actions = {
  /**
   * Saves the watched episode count, the score, or both, from the card's +1 button, the card's
   * back, or the score prompt after completing an anime. A field that isn't sent stays as it is
   */
  updateEntry: async (event) => {
    const limit = await takeClientLimit(event.getClientAddress(), 'write');
    if (!limit.allowed) {
      event.locals.retryAfter = Math.max(event.locals.retryAfter ?? 0, limit.retryAfter);
      return fail(429, { message: 'Too many updates, please try again shortly' });
    }
    const update = parseEntryUpdate(await event.request.formData());
    if ('message' in update) return fail(400, { message: update.message });
    const { mediaId, changes } = update;
    return updateOwnList(event, async (session) => ({
      mediaId,
      ...(await saveEntry(session.token, mediaId, changes)),
    }));
  },
};

import { error, fail, type RequestEvent } from '@sveltejs/kit';

import { AniListTokenError, AniListRateLimitError, saveEntry } from '#lib/server/anilist-client.js';
import { parseEntryUpdate } from '#lib/server/entry-update.js';
import { loadAnimePage } from '#lib/server/list-page.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import {
  MalRateLimitError,
  MalTokenError,
  saveEntry as saveMalEntry,
} from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import { DOMAIN_NAMES, isDomain, type Domain } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** Browser navigation defers the read so the viewer-scoped memory cache can serve it. */
export const load: import('./$types').PageServerLoad = async (event) => {
  if (!isDomain(event.params.domain)) error(404, `Unknown domain: ${event.params.domain}`);
  if (event.isDataRequest) return { deferred: true as const, username: event.params.username };
  return loadAnimePage(event);
};

/**
 * Runs an update on the signed-in user's own list on the page's service, whatever list the page
 * shows, and turns what can go wrong into a message for the card
 */
async function updateOwnList<T>(
  { locals, cookies }: Pick<RequestEvent, 'locals' | 'cookies'>,
  domain: Domain,
  update: () => Promise<T>
) {
  const service = DOMAIN_NAMES[domain];
  if (!(domain === 'anilist' ? locals.session : locals.malSession)) {
    return fail(401, { message: `Sign in with ${service} to update your list` });
  }
  try {
    return await update();
  } catch (err) {
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      return fail(429, { message: err.message });
    }
    console.error(err);
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      if (domain === 'anilist') clearSession(cookies);
      else clearMalSession(cookies);
      return fail(401, { message: `Your ${service} sign-in expired, please sign in again` });
    }
    return fail(502, { message: `${service} rejected the update, please try again` });
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
    const domain = event.params.domain;
    if (!isDomain(domain)) return fail(400, { message: 'Unknown list' });
    const update = parseEntryUpdate(await event.request.formData(), domain);
    if ('message' in update) return fail(400, { message: update.message });
    const { mediaId, malId, changes } = update;
    return updateOwnList(event, domain, async () => ({
      mediaId,
      ...(domain === 'anilist'
        ? await saveEntry(event.locals.session!.token, mediaId, changes)
        : await withMalToken(event, (token) => saveMalEntry(token, malId!, changes))),
    }));
  },
};

import { error, fail } from '@sveltejs/kit';

import { saveEntry } from '#lib/server/anilist-client.js';
import { parseEntryUpdate } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { loadAnimePage } from '#lib/server/list-page.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { saveEntry as saveMalEntry } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** Browser navigation defers the read so the viewer-scoped memory cache can serve it. */
export const load: import('./$types').PageServerLoad = async (event) => {
  if (!isDomain(event.params.domain)) error(404, `Unknown domain: ${event.params.domain}`);
  if (event.isDataRequest) return { deferred: true as const, username: event.params.username };
  return loadAnimePage(event);
};

export const actions: Actions = {
  /**
   * Saves the watched episode count, the score, or both, from the card's +1 button, the card's
   * back, or the score prompt after completing an anime. A field that isn't sent stays as it is.
   * The save is then copied to the account linked on the other service, if any; `linked` says when
   * that copy failed
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
    const { mediaId, malId, changes, episodes } = update;
    return updateOwnList(event, domain, async () => {
      const saved =
        domain === 'anilist'
          ? await saveEntry(event.locals.session!.token, mediaId, changes)
          : await withMalToken(event, (token) =>
              saveMalEntry(token, malId!, changes, { episodes })
            );
      const linked = await copyToLinkedAccount(event, domain, update, saved);
      return { mediaId, ...saved, ...(linked && { linked }) };
    });
  },
};

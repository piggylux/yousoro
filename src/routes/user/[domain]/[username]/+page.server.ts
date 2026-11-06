import { error, fail, redirect } from '@sveltejs/kit';

import { saveEntry } from '#lib/server/anilist-client.js';
import { parseEntryUpdate } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import {
  combinedOwner,
  loadAnimePage,
  mainListInstead,
  saveTarget,
} from '#lib/server/list-page.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { saveEntry as saveMalEntry } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain, listPath } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** Browser navigation defers the read so the viewer-scoped memory cache can serve it. */
export const load: import('./$types').PageServerLoad = async (event) => {
  const { domain, username } = event.params;
  if (!isDomain(domain)) error(404, `Unknown domain: ${domain}`);
  // Signed in to both services, the viewer's two lists show as one, on their main list. The URL is
  // only read here, so switching to the calendar doesn't run this load again
  const main = mainListInstead(event.locals, domain, username);
  if (main) redirect(303, `${listPath(main.domain, main.name)}${event.url.search}`);
  if (event.isDataRequest) return { deferred: true as const, username: event.params.username };
  return loadAnimePage(event);
};

export const actions: Actions = {
  /**
   * Saves the watched episode count, the score, or both, from the card's +1 button, the card's
   * back, or the score prompt after completing an anime. A field that isn't sent stays as it is.
   * The save goes to the list's service, or on a combined list, to the one the card names when its
   * anime is only on that one's list. It's then copied to the account on the other service, if
   * any; `linked` says when that copy failed
   */
  updateEntry: async (event) => {
    const limit = await takeClientLimit(event.getClientAddress(), 'write');
    if (!limit.allowed) {
      event.locals.retryAfter = Math.max(event.locals.retryAfter ?? 0, limit.retryAfter);
      return fail(429, { message: 'Too many updates, please try again shortly' });
    }
    const { domain, username } = event.params;
    if (!isDomain(domain)) return fail(400, { message: 'Unknown list' });
    const form = await event.request.formData();
    const target = saveTarget(event.locals, domain, username, form.get('list'));
    if (!target) return fail(400, { message: 'Unknown list' });
    const update = parseEntryUpdate(form, target);
    if ('message' in update) return fail(400, { message: update.message });
    const { mediaId, malId, changes, episodes } = update;
    // A combined list's card already says when MyAnimeList doesn't have its anime
    const copy = !(malId === undefined && combinedOwner(event.locals, domain, username));
    return updateOwnList(event, target, async () => {
      const saved =
        target === 'anilist'
          ? await saveEntry(event.locals.session!.token, mediaId, changes)
          : await withMalToken(event, (token) =>
              saveMalEntry(token, malId!, changes, { episodes })
            );
      const linked = copy ? await copyToLinkedAccount(event, target, update, saved) : null;
      return { mediaId, ...saved, ...(linked && { linked }) };
    });
  },
};

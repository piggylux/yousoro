import { fail } from '@sveltejs/kit';

import { saveEntry } from '#lib/server/anilist-client.js';
import { parseStartWatching } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { combinedOwner, saveTarget } from '#lib/server/list-page.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { startWatching } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

export const actions: Actions = {
  /**
   * Moves a planned anime to the signed-in user's "Watching" list, in one request to the list's
   * service, or on a combined list, to the other when the anime is only on that one's plan list. It
   * then copies that to the account on the other service, if any. The episode
   * count, score and dates stay as they are. The page updates the card from the answer rather than
   * reading the plan list again; `linked` says when the copy failed
   */
  startWatching: async (event) => {
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
    const start = parseStartWatching(form, target);
    if ('message' in start) return fail(400, { message: start.message });
    const { mediaId, malId } = start;
    // A combined list's anime that MyAnimeList doesn't have can only go on AniList's list
    const copy = !(malId === undefined && combinedOwner(event.locals, domain, username));
    return updateOwnList(event, target, async () => {
      const saved =
        target === 'anilist'
          ? await saveEntry(event.locals.session!.token, mediaId!, { status: 'CURRENT' })
          : await withMalToken(event, (token) => startWatching(token, malId!));
      const linked = copy
        ? await copyToLinkedAccount(
            event,
            target,
            { mediaId, malId, changes: { start: true } },
            saved
          )
        : null;
      return { mediaId, malId, ...saved, ...(linked && { linked }) };
    });
  },
};

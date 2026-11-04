import { fail } from '@sveltejs/kit';

import { saveEntry } from '#lib/server/anilist-client.js';
import { parseStartWatching } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { startWatching } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

export const actions: Actions = {
  /**
   * Moves a planned anime to the signed-in user's "Watching" list, in one request to the list's
   * service, then copies that to the account linked on the other service, if any. The episode
   * count, score and dates stay as they are. The page updates the card from the answer rather than
   * reading the plan list again; `linked` says when the copy failed
   */
  startWatching: async (event) => {
    const limit = await takeClientLimit(event.getClientAddress(), 'write');
    if (!limit.allowed) {
      event.locals.retryAfter = Math.max(event.locals.retryAfter ?? 0, limit.retryAfter);
      return fail(429, { message: 'Too many updates, please try again shortly' });
    }
    const domain = event.params.domain;
    if (!isDomain(domain)) return fail(400, { message: 'Unknown list' });
    const start = parseStartWatching(await event.request.formData(), domain);
    if ('message' in start) return fail(400, { message: start.message });
    const { mediaId, malId } = start;
    return updateOwnList(event, domain, async () => {
      const saved =
        domain === 'anilist'
          ? await saveEntry(event.locals.session!.token, mediaId!, { status: 'CURRENT' })
          : await withMalToken(event, (token) => startWatching(token, malId!));
      const linked = await copyToLinkedAccount(
        event,
        domain,
        { mediaId, malId, changes: { start: true } },
        saved
      );
      return { mediaId, malId, ...saved, ...(linked && { linked }) };
    });
  },
};

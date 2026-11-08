import { fail, type RequestEvent } from '@sveltejs/kit';

import { saveEntry } from '#lib/server/anilist-client.js';
import { parseListMove } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { moveToList } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { ListMove } from '#lib/types/api.js';
import { isDomain } from '#lib/types/domain.js';

/**
 * A form action moving an anime to the signed-in user's "Watching" list, as "Start watching" does
 * from the plan list or for a sequel that's out, or to their "Planning" list, as "Add to Planning"
 * does for a sequel that isn't. One request to the list's service, adding the anime when it isn't
 * there, then a copy to the account linked on the other service, if any. The episode count, score
 * and dates stay as they are. The page updates from the answer rather than reading the list again;
 * `linked` says when the copy failed
 */
export function moveToListAction(status: ListMove) {
  return async (
    event: Pick<RequestEvent, 'cookies' | 'locals' | 'request' | 'getClientAddress'> & {
      params: { domain: string };
    }
  ) => {
    const limit = await takeClientLimit(event.getClientAddress(), 'write');
    if (!limit.allowed) {
      event.locals.retryAfter = Math.max(event.locals.retryAfter ?? 0, limit.retryAfter);
      return fail(429, { message: 'Too many updates, please try again shortly' });
    }
    const domain = event.params.domain;
    if (!isDomain(domain)) return fail(400, { message: 'Unknown list' });
    const move = parseListMove(await event.request.formData(), domain);
    if ('message' in move) return fail(400, { message: move.message });
    const { mediaId, malId } = move;
    return updateOwnList(event, domain, async () => {
      const saved =
        domain === 'anilist'
          ? await saveEntry(event.locals.session!.token, mediaId!, { status })
          : await withMalToken(event, (token) => moveToList(token, malId!, status));
      const linked = await copyToLinkedAccount(
        event,
        domain,
        { mediaId, malId, changes: { move: status } },
        saved
      );
      return { mediaId, malId, ...saved, ...(linked && { linked }) };
    });
  };
}

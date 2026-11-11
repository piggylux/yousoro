import { error, fail } from '@sveltejs/kit';

import { getListEntry, saveEntry } from '#lib/server/anilist-client.js';
import { parseEntryUpdate, type EntryUpdate } from '#lib/server/entry-update.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { loadAnimePage } from '#lib/server/list-page.js';
import {
  addToListAction,
  moveToListAction,
  revertEntryAction,
  undoAddAction,
} from '#lib/server/move-to-list.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { saveEntry as saveMalEntry } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { addedDates, type BeforeFinish } from '#lib/types/api.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** Browser navigation defers the read so the viewer-scoped memory cache can serve it. */
export const load: import('./$types').PageServerLoad = async (event) => {
  if (!isDomain(event.params.domain)) error(404, `Unknown domain: ${event.params.domain}`);
  if (event.isDataRequest) return { deferred: true as const, username: event.params.username };
  return loadAnimePage(event);
};

/**
 * Saves to AniList. A save of the anime's last episode reads the entry first, as AniList then
 * finishes it, and may change its dates and rewatch count too: `beforeFinish` says what they were,
 * so reverting the save can put them back. Other saves take a single request. That read is only for
 * the history, so the save goes ahead without it when it fails
 */
async function saveToAniList(token: string, { mediaId, changes, episodes }: EntryUpdate) {
  const finishing =
    changes.progress !== undefined && episodes !== undefined && changes.progress >= episodes;
  const held = finishing ? await getListEntry(token, mediaId).catch(() => null) : null;
  const saved = await saveEntry(token, mediaId, changes);
  if (!held || held.status === 'COMPLETED' || saved.status !== 'COMPLETED') return saved;
  const { repeat: rewatched, startedAt, completedAt } = held;
  const beforeFinish: BeforeFinish = {
    rewatched,
    startedAt,
    completedAt,
    added: addedDates(held, saved),
  };
  return { ...saved, beforeFinish };
}

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
          ? await saveToAniList(event.locals.session!.token, update)
          : await withMalToken(event, (token) =>
              saveMalEntry(token, malId!, changes, { episodes })
            );
      const linked = await copyToLinkedAccount(event, domain, update, saved);
      return { mediaId, ...saved, ...(linked && { linked }) };
    });
  },
  /** Reverts a save of an episode count or score, from the history of recent changes */
  revertEntry: revertEntryAction(),
  /** Starts a sequel that's out, which the score prompt offers once an anime is finished */
  startWatching: moveToListAction('CURRENT'),
  /** Plans a sequel that isn't out yet, which the score prompt offers too */
  planToWatch: moveToListAction('PLANNING'),
  /** Adds an anime found by search, unless it's on the list already */
  addAnime: addToListAction(),
  /** Undoes an add from the search: back to the list it was on, or off the list when it was new */
  undoAdd: undoAddAction(),
};

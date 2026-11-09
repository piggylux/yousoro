import { fail, type RequestEvent } from '@sveltejs/kit';

import { getListStatus, saveEntry } from '#lib/server/anilist-client.js';
import { parseListMove } from '#lib/server/entry-update.js';
import {
  addDecision,
  copyToLinkedAccount,
  moveOnLinkedAccount,
  restoreEntry,
  undoOnLinkedAccount,
} from '#lib/server/linked-save.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { getListStatuses, moveToList } from '#lib/server/myanimelist-client.js';
import { updateOwnList } from '#lib/server/own-list.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isBefore, type Before, type ListMove } from '#lib/types/api.js';
import { isDomain, LIST_NAMES, type Domain } from '#lib/types/domain.js';

type MoveEvent = Pick<RequestEvent, 'cookies' | 'locals' | 'request' | 'getClientAddress'> & {
  params: { domain: string };
};

/**
 * Checks a form's write allowance, list and ids, then runs the move on the signed-in user's own
 * list, turning what can go wrong into a message for the page
 */
async function readMove<T>(
  event: MoveEvent,
  move: (domain: Domain, ids: { mediaId?: number; malId?: number }, form: FormData) => Promise<T>
) {
  const limit = await takeClientLimit(event.getClientAddress(), 'write');
  if (!limit.allowed) {
    event.locals.retryAfter = Math.max(event.locals.retryAfter ?? 0, limit.retryAfter);
    return fail(429, { message: 'Too many updates, please try again shortly' });
  }
  const domain = event.params.domain;
  if (!isDomain(domain)) return fail(400, { message: 'Unknown list' });
  const form = await event.request.formData();
  const ids = parseListMove(form, domain);
  if ('message' in ids) return fail(400, { message: ids.message });
  return updateOwnList(event, domain, () => move(domain, ids, form));
}

/**
 * One request to the list's service, adding the anime when it isn't there, then a copy to the
 * account linked on the other service, if any. The episode count, score and dates stay as they are
 */
async function saveMove(
  event: MoveEvent,
  domain: Domain,
  status: ListMove,
  { mediaId, malId }: { mediaId?: number; malId?: number }
) {
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
}

/**
 * A form action moving an anime to the signed-in user's "Watching" list, as "Start watching" does
 * from the plan list or for a sequel that's out, or to their "Planning" list, as "Add to Planning"
 * does for a sequel that isn't. The page has already checked where the anime is, so this is one
 * request to the list's service and a copy to the linked account. The page updates from the answer
 * rather than reading the list again; `linked` says when the copy failed
 */
export function moveToListAction(status: ListMove) {
  return (event: MoveEvent) =>
    readMove(event, (domain, ids) => saveMove(event, domain, status, ids));
}

/**
 * A form action adding an anime found by search to the signed-in user's "Watching" or "Planning"
 * list, sent as `list`, or moving one there `from` the plan, paused or dropped list the page saw it
 * on. Search results don't say where an anime is on the user's list, as the browser asks AniList for
 * them without the user's token, so the list's service is asked first, and so is the linked
 * account's before the move is made there: two requests to add one, and as many on the linked
 * account. `already` says it was there already. `before` and `linkedBefore` say where it was, for
 * undoing; `linked`, why the linked account wasn't changed. With `retry=linked`, after the linked
 * account missed an add, only the linked account is changed
 */
export function addToListAction() {
  return (event: MoveEvent) =>
    readMove(event, async (domain, ids, form) => {
      const to = form.get('list');
      if (to !== 'CURRENT' && to !== 'PLANNING') return fail(400, { message: 'Unknown list' });
      const from = form.get('from');
      const expected = isBefore(from) ? from : undefined;
      let listed: string | null;
      if (domain === 'anilist') {
        listed = await getListStatus(event.locals.session!.token, ids.mediaId!);
      } else {
        const statuses = await withMalToken(event, (token) => getListStatuses(token, [ids.malId!]));
        if (!statuses.has(ids.malId!)) {
          return fail(404, { message: "MyAnimeList doesn't have this anime" });
        }
        listed = statuses.get(ids.malId!)!;
      }
      const decision = addDecision(listed, to, expected);
      if (decision === 'blocked') {
        const name = LIST_NAMES[domain][listed!] ?? listed;
        return fail(409, { message: `Already on your ${name} list` });
      }
      if (decision === 'already') {
        if (form.get('retry') !== 'linked') return { ...ids, status: to, already: true };
        const { linked, linkedBefore } = await moveOnLinkedAccount(
          event,
          domain,
          ids,
          to,
          expected
        );
        return {
          ...ids,
          linkedOnly: true,
          ...(linkedBefore && { linkedBefore }),
          ...(linked && { linked }),
        };
      }
      const saved =
        domain === 'anilist'
          ? await saveEntry(event.locals.session!.token, ids.mediaId!, { status: to })
          : await withMalToken(event, (token) => moveToList(token, ids.malId!, to));
      const { linked, linkedBefore } = await moveOnLinkedAccount(event, domain, ids, to, expected);
      return {
        ...ids,
        ...saved,
        before: (listed as Before | null) ?? 'NONE',
        ...(linkedBefore && { linkedBefore }),
        ...(linked && { linked }),
      };
    });
}

/**
 * A form action undoing an add from the search, sent with the list it went to (`list`) and where
 * the anime was `before`: back to the plan, paused or dropped list it was moved from, or off the
 * list when it was new to it, only while the anime is still as the add left it. The linked
 * account's change is undone the same way when there was one (`linkedBefore`). Two requests on
 * each service: one to check, one to change
 */
export function undoAddAction() {
  return (event: MoveEvent) =>
    readMove(event, async (domain, ids, form) => {
      const set = form.get('list');
      const before = form.get('before');
      if ((set !== 'CURRENT' && set !== 'PLANNING') || !isBefore(before)) {
        return fail(400, { message: 'Nothing to undo' });
      }
      if ((await restoreEntry(event, domain, ids, set, before)) === 'changed') {
        return fail(409, {
          message: "It's changed since you added it, so it stays as it is. Change it on its card.",
        });
      }
      const linkedBefore = form.get('linkedBefore');
      const linked = isBefore(linkedBefore)
        ? await undoOnLinkedAccount(event, domain, ids, set, linkedBefore)
        : null;
      return { ...ids, undone: true, ...(linked && { linked }) };
    });
}

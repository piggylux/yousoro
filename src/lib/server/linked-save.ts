import type { Cookies } from '@sveltejs/kit';

import { toMalScore } from '#lib/score.js';
import {
  AniListRateLimitError,
  AniListTokenError,
  deleteEntry as deleteAniListEntry,
  getListEntry as getAniListEntry,
  getMediaByMalIds,
  saveEntry as saveAniListEntry,
  type EntryDates,
} from '#lib/server/anilist-client.js';
import type { EntryFields, EntryRevert, EntryUpdate } from '#lib/server/entry-update.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import {
  copyEntry,
  deleteEntry as deleteMalEntry,
  getListEntry as getMalEntry,
  MalNotFoundError,
  moveToList,
  MalRateLimitError,
  MalTokenError,
} from '#lib/server/myanimelist-client.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import type { Before, LinkedFailure, ListMove } from '#lib/types/api.js';
import { DOMAIN_NAMES, LIST_NAMES, type Domain } from '#lib/types/domain.js';

/**
 * The dates a revert clears, those the finish it reverts set, and whether it takes back a rewatch
 * the copy of that finish counted
 */
export type LinkedRevert = { clear: (keyof EntryDates)[]; uncountRewatch: boolean };

/**
 * Copies a save on one service to the user's account on the other, when they're signed in to both:
 * the episode count, status and dates as the save left them, and the score when it changed. A date
 * the save left unset doesn't clear the other's. These are the entry as it now is rather than a
 * change to it, so a copy that failed is made up by the next one. A start from the plan list only
 * copies the status, as does a sequel added to the plan list. A save from a MyAnimeList page that
 * didn't know the anime's AniList id looks it up first. The save itself has already succeeded, so
 * this never throws: a failure only comes back as a message for the user.
 *
 * A reverted save is copied the same way (`revert`). Reverting one that finished the anime also
 * clears the dates the entry didn't have before, and on MyAnimeList takes back the rewatch the copy
 * of the finish counted
 */
export async function copyToLinkedAccount(
  event: { cookies: Cookies; locals: App.Locals },
  from: Domain,
  { mediaId, malId, changes, scoreFormat }: Omit<EntryUpdate, 'mediaId'> & { mediaId?: number },
  saved: {
    progress: number;
    score: number;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
  },
  revert?: LinkedRevert
): Promise<LinkedFailure | null> {
  const to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  const aniListSession = event.locals.session;
  if (!(to === 'anilist' ? aniListSession : event.locals.malSession)) return null;
  const failed: Failed = (reason, retry = true) => ({
    message: `${revert ? 'Reverted' : 'Saved'} on ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });

  try {
    if (to === 'myanimelist') {
      if (malId === undefined) return failed("this anime isn't on MyAnimeList.", false);
      const score =
        changes.score !== undefined && scoreFormat
          ? toMalScore(saved.score, scoreFormat)
          : undefined;
      const entry = {
        progress: saved.progress,
        status: saved.status,
        score,
        startedAt: saved.startedAt,
        completedAt: saved.completedAt,
      };
      await withMalToken<unknown>(event, (token) => {
        if (changes.move) return moveToList(token, malId, changes.move);
        if (!revert) return copyEntry(token, malId, entry);
        return copyEntry(
          token,
          malId,
          { ...entry, clear: revert.clear },
          { countRewatch: false, uncountRewatch: revert.uncountRewatch }
        );
      });
    } else {
      const id =
        mediaId ??
        (malId === undefined ? undefined : (await getMediaByMalIds([malId])).get(malId)?.id);
      if (id === undefined) return failed("this anime isn't on AniList.", false);
      await saveAniListEntry(
        aniListSession!.token,
        id,
        changes.move
          ? { status: changes.move }
          : {
              progress: saved.progress,
              status: saved.status,
              startedAt: saved.startedAt,
              completedAt: saved.completedAt,
              ...(revert && { clear: revert.clear }),
              // A MyAnimeList score out of 10 is exact out of 100, in whatever format AniList shows it
              ...(changes.score !== undefined && { scoreRaw: saved.score * 10 }),
            }
      );
    }
    return null;
  } catch (err) {
    return linkedError(err, event, to, failed, 'copy a save to');
  }
}

type Failed = (reason: string, retry?: boolean) => LinkedFailure;

/**
 * What went wrong on the linked account, as a message for the user: the service busy, the anime
 * missing there, or its sign-in expired, which signs out of that service alone
 */
function linkedError(
  err: unknown,
  event: { cookies: Cookies; locals: App.Locals },
  to: Domain,
  failed: Failed,
  doing: string
): LinkedFailure {
  const service = DOMAIN_NAMES[to];
  if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
    return failed(`${service} is busy right now.`);
  }
  if (err instanceof MalNotFoundError) return failed("this anime isn't on MyAnimeList.", false);
  if (err instanceof AniListTokenError || err instanceof MalTokenError) {
    if (to === 'anilist') {
      clearSession(event.cookies);
      event.locals.session = null;
    } else {
      clearMalSession(event.cookies);
      event.locals.malSession = null;
    }
    return failed(`your ${service} sign-in expired. Link it again in settings.`, false);
  }
  console.error(`Could not ${doing} ${service}`, err);
  return failed(`${service} didn't take the update.`);
}

type ListEvent = { cookies: Cookies; locals: App.Locals };
type AnimeIds = { mediaId?: number; malId?: number };

/**
 * What adding an anime found by search does, given where it is on a list already: an anime not on
 * it is added, a planned one can be started, and a paused or dropped one resumed when that's where
 * the page saw it (`from`). One already where it's going stays as it is, and one on any other list
 * is the user's to change, as moving it would lose where it was
 */
export function addDecision(
  listed: string | null,
  to: ListMove,
  from?: Before
): 'save' | 'already' | 'blocked' {
  if (listed === null) return 'save';
  if (listed === to) return 'already';
  const resumed = from !== undefined && from !== 'NONE' && listed === from;
  return to === 'CURRENT' && (listed === 'PLANNING' || resumed) ? 'save' : 'blocked';
}

/**
 * Whether an entry holds nothing but its list status: no episode watched, no score, never watched
 * again. Undoing an add only takes such an entry off a list, as one with more in it was there before,
 * or has been watched since, and taking it off would lose that
 */
export function holdsOnlyStatus(entry: { progress: number; score: number; rewatched: number }) {
  return entry.progress === 0 && entry.score === 0 && entry.rewatched === 0;
}

/** One anime on a list, in AniList's terms, with what undoing compares and deleting takes */
type Held = {
  status: string;
  progress: number;
  score: number;
  rewatched: number;
  id?: number;
} & EntryDates;

/**
 * The user's entry for an anime on a service's list, or null when it's not there: by AniList id on
 * AniList and MyAnimeList id on MyAnimeList, which the caller has made sure of
 */
async function readEntry(event: ListEvent, domain: Domain, ids: AnimeIds): Promise<Held | null> {
  if (domain === 'myanimelist') {
    return withMalToken(event, (token) => getMalEntry(token, ids.malId!));
  }
  const entry = await getAniListEntry(event.locals.session!.token, ids.mediaId!);
  return entry && { ...entry, rewatched: entry.repeat };
}

/** Moves an anime on a service's list, adding it when it isn't there; the rest of it stays */
async function writeStatus(
  event: ListEvent,
  domain: Domain,
  ids: AnimeIds,
  status: ListMove | 'PAUSED' | 'DROPPED'
) {
  if (domain === 'myanimelist') {
    await withMalToken(event, (token) => moveToList(token, ids.malId!, status));
  } else {
    await saveAniListEntry(event.locals.session!.token, ids.mediaId!, { status });
  }
}

/**
 * Puts an anime back where it was before an add from the search set it on `set`'s list: back on
 * the list it came from, or off the list when it was new to it, then only while it holds nothing
 * but its status. One changed since, moved on or watched, stays as it is: 'changed', as does one
 * whose episode count is no longer what the add left (`progress`), when that's known. One no longer
 * on the list has nothing to undo
 */
export async function restoreEntry(
  event: ListEvent,
  domain: Domain,
  ids: AnimeIds,
  set: ListMove,
  before: Before,
  progress?: number
): Promise<'done' | 'changed'> {
  const held = await readEntry(event, domain, ids);
  if (!held) return 'done';
  if (held.status !== set) return 'changed';
  if (progress !== undefined && held.progress !== progress) return 'changed';
  if (before !== 'NONE') {
    await writeStatus(event, domain, ids, before);
    return 'done';
  }
  if (!holdsOnlyStatus(held)) return 'changed';
  await deleteHeld(event, domain, ids, held);
  return 'done';
}

/** Whether an entry holds what a save found or left, in the fields it changed */
function holds(held: Held, fields: EntryFields) {
  return (Object.keys(fields) as (keyof EntryFields)[]).every(
    (name) => held[name] === fields[name]
  );
}

/**
 * Reverts a save of an episode count or score on a service's list, from the history: puts back what
 * the fields the save changed held `before` it, while they still hold what it left (`after`). Other
 * fields stay as they are, so a change made elsewhere since is kept. Reverting a save that finished
 * the anime also puts back how many times it was watched again and its dates. One that changed
 * since, or is no longer on the list, stays as it is: 'changed'. One reverted already is left as it
 * is, so trying again only copies it to the linked account. Returns the entry as it now is
 */
export async function revertSave(
  event: ListEvent,
  domain: Domain,
  ids: AnimeIds,
  { before, after, beforeFinish }: EntryRevert
): Promise<'changed' | ({ progress: number; score: number; status: string } & EntryDates)> {
  const held = await readEntry(event, domain, ids);
  if (!held) return 'changed';
  const { status, progress, score, startedAt, completedAt } = held;
  if (holds(held, before)) return { status, progress, score, startedAt, completedAt };
  if (!holds(held, after)) return 'changed';

  // A finish also changed the dates and the rewatch count, which go back with it
  const dates = beforeFinish
    ? { startedAt: beforeFinish.startedAt, completedAt: beforeFinish.completedAt }
    : { startedAt, completedAt };
  const finish = beforeFinish && { rewatched: beforeFinish.rewatched, clear: beforeFinish.added };
  if (domain === 'anilist') {
    return saveAniListEntry(event.locals.session!.token, ids.mediaId!, {
      ...before,
      ...(finish && { ...dates, repeat: finish.rewatched, clear: finish.clear }),
    });
  }
  // MyAnimeList's own update can't put a rewatch back, as it only sets the status
  const restored = {
    status: before.status ?? status,
    progress: before.progress ?? progress,
    score: before.score ?? score,
    ...dates,
  };
  await withMalToken(event, (token) =>
    copyEntry(token, ids.malId!, { ...restored, ...finish }, { countRewatch: false })
  );
  return restored;
}

/** Takes an anime off a service's list: by MyAnimeList id there, by the entry's own id on AniList */
async function deleteHeld(event: ListEvent, domain: Domain, ids: AnimeIds, held: Held) {
  if (domain === 'myanimelist') {
    await withMalToken(event, (token) => deleteMalEntry(token, ids.malId!));
  } else {
    await deleteAniListEntry(event.locals.session!.token, held.id!);
  }
}

/**
 * Takes an anime off a service's plan list, as Remove on the plan page does, while it's only planned
 * there: no episode watched, no score, never watched again. One no longer on the list is off it
 * already ('absent'). One on another list now, or holding more than its status, stays, and says
 * where it is (`kept`), as taking it off would lose that
 */
export async function removePlanned(
  event: ListEvent,
  domain: Domain,
  ids: AnimeIds
): Promise<'removed' | 'absent' | { kept: string }> {
  const held = await readEntry(event, domain, ids);
  if (!held) return 'absent';
  if (held.status !== 'PLANNING' || !holdsOnlyStatus(held)) return { kept: held.status };
  await deleteHeld(event, domain, ids, held);
  return 'removed';
}

/**
 * Puts an anime back on a service's plan list, undoing Remove: added when it isn't on the list,
 * left as it is when it's planned again already. One on another list now stays there (`kept`)
 */
export async function replan(
  event: ListEvent,
  domain: Domain,
  ids: AnimeIds
): Promise<'planned' | { kept: string }> {
  const held = await readEntry(event, domain, ids);
  if (held && held.status !== 'PLANNING') return { kept: held.status };
  if (!held) await writeStatus(event, domain, ids, 'PLANNING');
  return 'planned';
}

/**
 * Why an anime stays where it is on a service, from where it is there: "it has been watched or
 * scored on AniList", or "it's on your Completed list on AniList"
 */
export function keptReason(domain: Domain, status: string): string {
  const service = DOMAIN_NAMES[domain];
  return status === 'PLANNING'
    ? `it has been watched or scored on ${service}`
    : `it's on your ${LIST_NAMES[domain][status] ?? status} list on ${service}`;
}

/**
 * Does on the linked account what Remove did on the list's own service, under the same rule: one
 * not only planned there stays, which `linked` says. `linkedRemoved` says it was taken off there,
 * for undoing. Never throws, as the removal itself has already succeeded
 */
export async function removeOnLinkedAccount(
  event: ListEvent,
  from: Domain,
  ids: AnimeIds
): Promise<{ linked: LinkedFailure | null; linkedRemoved?: true }> {
  const failed: Failed = (reason, retry = true) => ({
    message: `Removed from ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });
  let to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  try {
    const target = await linkedTarget(event, from, ids);
    // Not signed in there, or the anime isn't on that service: there's nothing to take off
    if (!target?.ids) return { linked: null };
    to = target.to;
    const outcome = await removePlanned(event, to, target.ids);
    if (outcome === 'removed') return { linked: null, linkedRemoved: true };
    if (outcome === 'absent') return { linked: null };
    return { linked: failed(`${keptReason(to, outcome.kept)}, so it stays there.`, false) };
  } catch (err) {
    return { linked: linkedError(err, event, to, failed, 'remove it from') };
  }
}

/**
 * Undoes Remove on the linked account, when it took the anime off there too: puts it back on the
 * plan list there, unless it's on another list there now. Never throws
 */
export async function replanOnLinkedAccount(
  event: ListEvent,
  from: Domain,
  ids: AnimeIds
): Promise<LinkedFailure | null> {
  const failed: Failed = (reason, retry = true) => ({
    message: `Back on your plan list on ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });
  let to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  try {
    const target = await linkedTarget(event, from, ids);
    if (!target?.ids) return null;
    to = target.to;
    const outcome = await replan(event, to, target.ids);
    return outcome === 'planned'
      ? null
      : failed(`${keptReason(to, outcome.kept)} now, so it stays there.`, false);
  } catch (err) {
    return linkedError(err, event, to, failed, 'put it back on the plan list on');
  }
}

/**
 * The linked service, when the user is signed in to it, and the anime's id there: its MyAnimeList
 * id, or its AniList id, looked up by its MyAnimeList id when the page didn't know it. No id means
 * the anime isn't on that service
 */
async function linkedTarget(
  event: ListEvent,
  from: Domain,
  { mediaId, malId }: AnimeIds
): Promise<{ to: Domain; ids: AnimeIds | null } | null> {
  const to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  if (!(to === 'anilist' ? event.locals.session : event.locals.malSession)) return null;
  if (to === 'myanimelist') return { to, ids: malId === undefined ? null : { malId } };
  const id =
    mediaId ?? (malId === undefined ? undefined : (await getMediaByMalIds([malId])).get(malId)?.id);
  return { to, ids: id === undefined ? null : { mediaId: id } };
}

/**
 * Makes on the linked account the move an add from the search made on the list's own service, as
 * the add itself decides it: checked against where the anime is there, so one already there, or on
 * another list there, is left as it is. `linkedBefore` says where it was when it was moved, for
 * undoing; `linked` says why it wasn't. Never throws, as the add itself has already succeeded
 */
export async function moveOnLinkedAccount(
  event: ListEvent,
  from: Domain,
  ids: AnimeIds,
  move: ListMove,
  expected?: Before
): Promise<{ linked: LinkedFailure | null; linkedBefore?: Before }> {
  const failed: Failed = (reason, retry = true) => ({
    message: `Saved on ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });
  let to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  try {
    const target = await linkedTarget(event, from, ids);
    if (!target) return { linked: null };
    to = target.to;
    const service = DOMAIN_NAMES[to];
    if (!target.ids) return { linked: failed(`this anime isn't on ${service}.`, false) };
    const status = (await readEntry(event, to, target.ids))?.status ?? null;
    const decision = addDecision(status, move, expected);
    if (decision === 'already') return { linked: null };
    if (decision === 'blocked') {
      return { linked: failed(`${keptReason(to, status!)}, so it stays there.`, false) };
    }
    await writeStatus(event, to, target.ids, move);
    return { linked: null, linkedBefore: (status as Before | null) ?? 'NONE' };
  } catch (err) {
    return { linked: linkedError(err, event, to, failed, 'copy an add to') };
  }
}

/**
 * Undoes on the linked account what an add from the search did there: puts the anime back where it
 * was before (`linkedBefore`), unless it has changed there since. Never throws: a failure, or an
 * entry kept, comes back as a message for the user
 */
export async function undoOnLinkedAccount(
  event: ListEvent,
  from: Domain,
  ids: AnimeIds,
  set: ListMove,
  linkedBefore: Before
): Promise<LinkedFailure | null> {
  const failed: Failed = (reason, retry = true) => ({
    message: `Undone on ${DOMAIN_NAMES[from]}, but ${reason}`,
    retry,
  });
  let to: Domain = from === 'anilist' ? 'myanimelist' : 'anilist';
  try {
    const target = await linkedTarget(event, from, ids);
    if (!target?.ids) return null;
    to = target.to;
    const done = await restoreEntry(event, to, target.ids, set, linkedBefore);
    return done === 'changed'
      ? failed(`it has changed on ${DOMAIN_NAMES[to]} since, so it stays as it is there.`, false)
      : null;
  } catch (err) {
    return linkedError(err, event, to, failed, 'undo an add on');
  }
}

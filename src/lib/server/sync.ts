import type { Cookies } from '@sveltejs/kit';

import { score100ToMal } from '#lib/score.js';
import {
  AniListRateLimitError,
  AniListTokenError,
  fromFuzzyDate,
  getAllListEntries,
  getMediaByMalIds,
  saveEntries,
} from '#lib/server/anilist-client.js';
import { withMalToken } from '#lib/server/myanimelist-auth.js';
import {
  copyEntry,
  getAllEntries,
  MalNotFoundError,
  MalRateLimitError,
  MalTokenError,
  toAniListStatus,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import {
  planSync,
  SYNC_BATCH_SIZE,
  type SyncCandidate,
  type SyncChange,
  type SyncEntry,
  type SyncPlan,
  type SyncResult,
} from '#lib/sync.js';
import { DOMAIN_NAMES, isDomain, type Domain } from '#lib/types/domain.js';

type SignedInEvent = { cookies: Cookies; locals: App.Locals };

const STATUSES = ['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING'];

function fromMal({ list_status }: MalEntry): SyncEntry {
  return {
    status: toAniListStatus(list_status),
    progress: list_status.num_episodes_watched,
    score100: list_status.score * 10,
    startedAt: list_status.start_date || null,
    completedAt: list_status.finish_date || null,
    updatedAt: Date.parse(list_status.updated_at) || null,
  };
}

/**
 * Compares the signed-in user's whole AniList and MyAnimeList lists, every anime in any status,
 * matched by MyAnimeList id. Each list takes a few requests to read, however long. An anime only on
 * MyAnimeList's list is shown as MyAnimeList has it, and found on AniList only once it's synced
 * there, so a first sync of a long list doesn't spend AniList's budget before anything is chosen.
 * Needs both sign-ins
 */
export async function getSyncPlan(event: SignedInEvent): Promise<SyncPlan> {
  const session = event.locals.session!;
  // Both reads finish before any failure is reported, so a MyAnimeList sign-in renewed meanwhile is
  // still saved in this response. AniList's list is read by id, as the name saved at sign-in may
  // have changed since
  const [aniListRead, malRead] = await Promise.allSettled([
    getAllListEntries(session.user.id, session.token),
    withMalToken(event, (token) => getAllEntries(token)),
  ]);
  if (aniListRead.status === 'rejected') throw aniListRead.reason;
  if (malRead.status === 'rejected') throw malRead.reason;

  const byMalId = new Map<number, SyncCandidate>();
  const unmatched: string[] = [];
  for (const entry of aniListRead.value) {
    const { media, status, progress, score, updatedAt } = entry;
    if (media.idMal === null) {
      unmatched.push(media.title.romaji);
      continue;
    }
    if (byMalId.has(media.idMal)) continue;
    byMalId.set(media.idMal, {
      mediaId: media.id,
      malId: media.idMal,
      title: media.title.romaji,
      coverUrl: media.coverImage.extraLarge,
      isAdult: media.isAdult,
      anilist: {
        status,
        progress,
        score100: score,
        startedAt: fromFuzzyDate(entry.startedAt),
        completedAt: fromFuzzyDate(entry.completedAt),
        updatedAt: updatedAt ? updatedAt * 1000 : null,
      },
      myanimelist: null,
    });
  }
  for (const entry of malRead.value) {
    const candidate = byMalId.get(entry.node.id);
    if (candidate) candidate.myanimelist = fromMal(entry);
    else {
      byMalId.set(entry.node.id, {
        mediaId: null,
        malId: entry.node.id,
        title: entry.node.title,
        coverUrl: entry.node.main_picture?.large ?? null,
        isAdult: entry.node.nsfw === 'black',
        anilist: null,
        myanimelist: fromMal(entry),
      });
    }
  }

  const items = planSync([...byMalId.values()]).sort((a, b) => a.title.localeCompare(b.title));
  return { items, unmatched: unmatched.sort((a, b) => a.localeCompare(b)) };
}

const isCount = (value: unknown, max: number, min = 0): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** A date as both services write it, as far as it's known, or none */
const isDate = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(value));

/**
 * The changes a request asks to apply, a few at a time so each request stays short, or null when
 * they don't fit. They're written to the user's own lists, so they're checked for shape only
 */
export function parseSyncChanges(value: unknown): SyncChange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > SYNC_BATCH_SIZE) return null;
  const changes: SyncChange[] = [];
  for (const change of value as Record<string, unknown>[]) {
    const entry = change?.entry as Record<string, unknown> | undefined;
    if (
      !(change?.mediaId === null || isCount(change?.mediaId, 1e9, 1)) ||
      !isCount(change.malId, 1e9, 1) ||
      typeof change.to !== 'string' ||
      !isDomain(change.to) ||
      !STATUSES.includes(entry?.status as string) ||
      !isCount(entry?.progress, 1e5) ||
      !isCount(entry?.score100, 100) ||
      !isDate(entry?.startedAt ?? null) ||
      !isDate(entry?.completedAt ?? null)
    ) {
      return null;
    }
    changes.push({
      mediaId: change.mediaId as number | null,
      malId: change.malId,
      to: change.to,
      entry: {
        status: entry.status as string,
        progress: entry.progress as number,
        score100: entry.score100 as number,
        startedAt: (entry.startedAt as string | null | undefined) ?? null,
        completedAt: (entry.completedAt as string | null | undefined) ?? null,
        updatedAt: null,
      },
    });
  }
  return changes;
}

/** How a batch of changes went */
export type SyncOutcome = {
  results: SyncResult[];
  /** The service that was too busy for some of the changes, and how long it asks to wait */
  busy?: { service: string; retryAfter: number };
  /** Why syncing can't go on, as when a sign-in can't be renewed; that service is signed out */
  stopped?: string;
};

const FAILED = "Couldn't update";

/**
 * Writes a few anime's entries to the services they're copied to. AniList takes all of its changes
 * in one request, after one more to find the anime only on MyAnimeList's list; MyAnimeList, one
 * request per change. Both give way to list reads and saves when busy, as a sync can wait. When one
 * service is busy, the other's changes still go ahead
 */
export async function applySyncChanges(
  event: SignedInEvent,
  changes: SyncChange[]
): Promise<SyncOutcome> {
  const results: SyncResult[] = changes.map(() => null);
  const outcome: SyncOutcome = { results };
  // A busy service or a sign-in that can't be renewed ends that service's part of the batch
  const halts = (err: unknown, to: Domain) => {
    const service = DOMAIN_NAMES[to];
    if (err instanceof AniListRateLimitError || err instanceof MalRateLimitError) {
      const retryAfter = Math.max(outcome.busy?.retryAfter ?? 0, err.retryAfter);
      outcome.busy = { service, retryAfter };
      return true;
    }
    if (err instanceof AniListTokenError || err instanceof MalTokenError) {
      if (to === 'anilist') clearSession(event.cookies);
      else clearMalSession(event.cookies);
      outcome.stopped = `Your ${service} sign-in expired. Sign in again to sync.`;
      return true;
    }
    console.error(`Could not sync to ${service}`, err);
    return false;
  };
  const indexes = (to: Domain) => changes.flatMap((change, i) => (change.to === to ? [i] : []));

  await saveToAniList(event.locals.session!.token, changes, indexes('anilist'), results, halts);

  for (const i of indexes('myanimelist')) {
    const { progress, status, score100, startedAt, completedAt } = changes[i].entry;
    try {
      await withMalToken(event, (token) =>
        copyEntry(
          token,
          changes[i].malId,
          { progress, status, score: score100ToMal(score100), startedAt, completedAt },
          { countRewatch: false, priority: 'optional' }
        )
      );
      results[i] = true;
    } catch (err) {
      if (err instanceof MalNotFoundError) results[i] = "MyAnimeList doesn't have this anime";
      else if (halts(err, 'myanimelist')) break;
      else results[i] = FAILED;
    }
  }
  return outcome;
}

async function saveToAniList(
  token: string,
  changes: SyncChange[],
  indexes: number[],
  results: SyncResult[],
  halts: (err: unknown, to: Domain) => boolean
) {
  // Anime only on MyAnimeList's list are found on AniList by their MyAnimeList id
  const mediaIds = new Map<number, number>();
  for (const i of indexes) if (changes[i].mediaId !== null) mediaIds.set(i, changes[i].mediaId!);
  const unknown = indexes.filter((i) => !mediaIds.has(i));
  if (unknown.length) {
    try {
      const media = await getMediaByMalIds(
        unknown.map((i) => changes[i].malId),
        'optional'
      );
      for (const i of unknown) {
        const found = media.get(changes[i].malId);
        if (found) mediaIds.set(i, found.id);
        else results[i] = "AniList doesn't have this anime";
      }
    } catch (err) {
      if (halts(err, 'anilist')) return;
      for (const i of unknown) results[i] = FAILED;
    }
  }

  const ready = indexes.filter((i) => mediaIds.has(i));
  const entry = (i: number) => {
    const { progress, status, score100, startedAt, completedAt } = changes[i].entry;
    return {
      mediaId: mediaIds.get(i)!,
      progress,
      status,
      scoreRaw: score100,
      startedAt,
      completedAt,
    };
  };
  try {
    await saveEntries(token, ready.map(entry), 'optional');
    for (const i of ready) results[i] = true;
  } catch (err) {
    if (halts(err, 'anilist')) return;
    if (ready.length === 1) results[ready[0]] = FAILED;
    // AniList refuses the whole request when it refuses one change, so each is tried on its own
    else {
      for (const i of ready) {
        try {
          await saveEntries(token, [entry(i)], 'optional');
          results[i] = true;
        } catch (err) {
          if (halts(err, 'anilist')) return;
          results[i] = FAILED;
        }
      }
    }
  }
}

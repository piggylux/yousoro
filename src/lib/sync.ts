import { score100ToMal } from '#lib/score.js';
import type { Domain } from '#lib/types/domain.js';

/** An anime's entry on one service, in terms both share: AniList's statuses, a score out of 100 */
export type SyncEntry = {
  /** AniList's list status: CURRENT, REPEATING, COMPLETED, PAUSED, DROPPED or PLANNING */
  status: string;
  progress: number;
  /** 0 when unscored */
  score100: number;
  /** When the user started and finished watching it: YYYY-MM-DD, or YYYY-MM or YYYY when partly known */
  startedAt: string | null;
  completedAt: string | null;
  /** When it last changed, as Unix time in ms; null when the service doesn't say */
  updatedAt: number | null;
};

/** One anime as each service's list has it, or null on a list that doesn't have it */
export type SyncCandidate = {
  /** AniList's id; null for an anime only on MyAnimeList's list, found on AniList when it's synced */
  mediaId: number | null;
  /** MyAnimeList's id, which tells anime apart on both services */
  malId: number;
  title: string;
  coverUrl: string | null;
  isAdult: boolean;
  anilist: SyncEntry | null;
  myanimelist: SyncEntry | null;
};

/**
 * Whether the sync page is offered. It's switched off for now: its page and API answer "not found"
 * and nothing links to them. Saves still go to both linked accounts
 */
export const SYNC_ENABLED = false;

/** How many changes one request may apply: AniList saves them in one go, MyAnimeList one by one */
export const SYNC_BATCH_SIZE = 10;

/** An anime the two lists see differently, and the service it's best copied to */
export type SyncItem = SyncCandidate & { to: Domain };

/** A copy to make: the source's entry, written to the `to` service */
export type SyncChange = { mediaId: number | null; malId: number; to: Domain; entry: SyncEntry };

export type SyncPlan = {
  items: SyncItem[];
  /** Anime on AniList's list that MyAnimeList doesn't know, so they can't be compared */
  unmatched: string[];
};

/**
 * How each change in a request went, in the order asked: true when made, why not when it failed,
 * null when it wasn't tried and is to be sent again
 */
export type SyncResult = true | string | null;

/**
 * Whether two entries say the same. Scores are compared as MyAnimeList keeps them, in whole numbers
 * out of 10, so a score rounded on its way to MyAnimeList doesn't come back as a difference
 */
export function sameEntry(a: SyncEntry, b: SyncEntry): boolean {
  return (
    a.status === b.status &&
    a.progress === b.progress &&
    score100ToMal(a.score100) === score100ToMal(b.score100) &&
    a.startedAt === b.startedAt &&
    a.completedAt === b.completedAt
  );
}

/**
 * Where to copy an anime by default: from the list where it changed last. AniList counts any edit
 * as a change, a new score or note included, so with the same status on both lists, the list that's
 * ahead on episodes is copied instead, rather than taking episodes back off the other
 */
function suggestTarget(anilist: SyncEntry | null, myanimelist: SyncEntry | null): Domain {
  if (!anilist) return 'anilist';
  if (!myanimelist) return 'myanimelist';
  const aniListNewer = (anilist.updatedAt ?? 0) >= (myanimelist.updatedAt ?? 0);
  const newerIsBehind =
    anilist.status === myanimelist.status &&
    (aniListNewer
      ? anilist.progress < myanimelist.progress
      : myanimelist.progress < anilist.progress);
  return aniListNewer !== newerIsBehind ? 'myanimelist' : 'anilist';
}

/**
 * The writes that copy an anime to `to`: its entry from the other list, written there. A score or a
 * date only the target has is kept rather than cleared, and copied back to the other list too, so
 * after syncing both lists agree
 */
export function changesFor(item: SyncItem, to: Domain): SyncChange[] {
  const from: Domain = to === 'anilist' ? 'myanimelist' : 'anilist';
  const source = item[from];
  if (!source) return [];
  const target = item[to];
  const entry: SyncEntry = {
    ...source,
    score100: source.score100 || (target?.score100 ?? 0),
    startedAt: source.startedAt ?? target?.startedAt ?? null,
    completedAt: source.completedAt ?? target?.completedAt ?? null,
  };
  const write = (service: Domain) => ({
    mediaId: item.mediaId,
    malId: item.malId,
    to: service,
    entry,
  });
  const filled =
    entry.score100 !== source.score100 ||
    entry.startedAt !== source.startedAt ||
    entry.completedAt !== source.completedAt;
  return filled ? [write(to), write(from)] : [write(to)];
}

/**
 * The anime the two lists see differently, each to be copied from the list where it changed last,
 * or to the list that doesn't have it. Without a record of earlier syncs, a missing entry can't be
 * told from a deleted one, so nothing is ever deleted
 */
export function planSync(candidates: SyncCandidate[]): SyncItem[] {
  return candidates.flatMap((candidate) => {
    const { anilist, myanimelist } = candidate;
    if (anilist && myanimelist && sameEntry(anilist, myanimelist)) return [];
    return [{ ...candidate, to: suggestTarget(anilist, myanimelist) }];
  });
}

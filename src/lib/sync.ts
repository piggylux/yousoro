import { score100ToMal } from '#lib/score.js';
import { LIST_NAMES, type Domain } from '#lib/types/domain.js';

/**
 * What an entry holds beyond what the two lists are compared on. An import file that overwrites an
 * entry writes these back as the target list has them, so they aren't lost
 */
export type SyncExtras = {
  /** The user's own notes: AniList's notes, MyAnimeList's comments */
  notes?: string;
  /** How many times it was watched again */
  rewatched?: number;
  /** MyAnimeList's tags, priority (0 low, 1 medium, 2 high) and rewatch value (0 unset, 1 to 5) */
  tags?: string[];
  priority?: number;
  rewatchValue?: number;
};

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
  /** Kept as they are rather than compared */
  extras?: SyncExtras;
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
 * Whether the sync page is offered. Switching it off makes its page and API answer "not found" and
 * hides every link to them; saves still go to both linked accounts
 */
export const SYNC_ENABLED = true;

/**
 * How many anime the sync page applies through the services' APIs at once. MyAnimeList takes one
 * request per anime, and each service's requests are shared by everyone using this site, so more
 * than this go through each site's import page instead, which costs none
 */
export const SYNC_DIRECT_LIMIT = 10;

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
 * What's compared of an entry, as text: with the score as MyAnimeList keeps it, as sameEntry
 * compares them, or `exactly` as it's kept, to tell outcomes apart
 */
function signature(entry: SyncEntry | null, exactly = false): string {
  if (!entry) return '-';
  const { status, progress, score100, startedAt, completedAt } = entry;
  const score = exactly ? score100 : score100ToMal(score100);
  return [status, progress, score, startedAt, completedAt].join(',');
}

/**
 * Whether two entries say the same. Scores are compared as MyAnimeList keeps them, in whole numbers
 * out of 10, so a score rounded on its way to MyAnimeList doesn't come back as a difference
 */
export function sameEntry(a: SyncEntry, b: SyncEntry): boolean {
  return signature(a) === signature(b);
}

/**
 * A short name for how an anime differs between the lists, the same on the server and in the
 * browser, and the same until either entry changes again: it tells a difference already seen from
 * a new one
 */
export function differenceKey(item: SyncCandidate): string {
  const text = `${item.malId}|${signature(item.anilist)}|${signature(item.myanimelist)}`;
  // FNV-1a, 32 bits: short, and the same everywhere without a crypto library
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${item.malId.toString(36)}.${(hash >>> 0).toString(36)}`;
}

const SERVICES: Domain[] = ['anilist', 'myanimelist'];
const otherService = (service: Domain): Domain =>
  service === 'anilist' ? 'myanimelist' : 'anilist';

/** The parts of an entry that can be taken from either list: status and episodes go together */
export type SyncField = 'progress' | 'score' | 'startedAt' | 'completedAt';
export const SYNC_FIELDS: SyncField[] = ['progress', 'score', 'startedAt', 'completedAt'];

/** Which list each part of an entry is taken from, when the two are mixed */
export type SyncPicks = Record<SyncField, Domain>;

/**
 * How an anime is synced: copied to one list (`Domain`), which keeps the other list's entry, or
 * mixed, taking each part from the list picked for it
 */
export type SyncChoice = Domain | SyncPicks;

const allFrom = (from: Domain): SyncPicks => ({
  progress: from,
  score: from,
  startedAt: from,
  completedAt: from,
});

/**
 * The entry both lists end up with: each part from the list picked for it. A score or a date the
 * picked list hasn't got is taken from the other rather than cleared. Null when the list picked for
 * the status and episodes doesn't have the anime
 */
function combined(item: SyncCandidate, picks: SyncPicks): SyncEntry | null {
  const base = item[picks.progress];
  if (!base) return null;
  const from = (field: SyncField) => item[picks[field]];
  const fallback = (field: SyncField) => item[otherService(picks[field])];
  return {
    status: base.status,
    progress: base.progress,
    score100: from('score')?.score100 || (fallback('score')?.score100 ?? 0),
    startedAt: from('startedAt')?.startedAt ?? fallback('startedAt')?.startedAt ?? null,
    completedAt: from('completedAt')?.completedAt ?? fallback('completedAt')?.completedAt ?? null,
    updatedAt: base.updatedAt,
  };
}

/**
 * The parts of an entry the two lists hold different values for. A score or a date only one list
 * has isn't one: it's kept whichever list is copied
 */
export function conflicts(item: SyncCandidate): SyncField[] {
  const { anilist, myanimelist } = item;
  if (!anilist || !myanimelist) return [];
  return SYNC_FIELDS.filter((field) => {
    if (field === 'progress') {
      return anilist.status !== myanimelist.status || anilist.progress !== myanimelist.progress;
    }
    if (field === 'score') {
      return (
        anilist.score100 > 0 &&
        myanimelist.score100 > 0 &&
        score100ToMal(anilist.score100) !== score100ToMal(myanimelist.score100)
      );
    }
    return (
      anilist[field] !== null &&
      myanimelist[field] !== null &&
      anilist[field] !== myanimelist[field]
    );
  });
}

/** Whether mixing the two entries can end differently from copying either: two parts disagree */
export const canMix = (item: SyncCandidate) => conflicts(item).length >= 2;

/**
 * Where mixing an anime starts: status, episodes and dates from the list suggested, which is the
 * one further along when the list changed last is behind, and the score from the list changed last,
 * as a change there that didn't move the episodes is likely a new score
 */
export function defaultMix(item: SyncItem): SyncPicks {
  const newer: Domain =
    (item.anilist?.updatedAt ?? 0) >= (item.myanimelist?.updatedAt ?? 0)
      ? 'anilist'
      : 'myanimelist';
  return { ...allFrom(otherService(item.to)), score: newer };
}

/**
 * The writes that sync an anime as chosen: copied to one list, written there with the other list's
 * entry, or mixed, written to whichever list differs from the mix. A score or a date the copied
 * entry hasn't got is kept rather than cleared, and copied back to the other list too, so after
 * syncing both lists agree. Only what's compared is copied, and a list that already says the same
 * isn't written to. A finer AniList score that rounds to the copied one stays as it is
 */
export function changesFor(item: SyncCandidate, choice: SyncChoice): SyncChange[] {
  const copy = typeof choice === 'string';
  const entry = combined(item, copy ? allFrom(otherService(choice)) : choice);
  if (!entry) return [];
  return (copy ? [choice, otherService(choice)] : SERVICES).flatMap((service) => {
    const current = item[service];
    if (current && sameEntry(entry, current)) return [];
    const score100 =
      current && score100ToMal(current.score100) === score100ToMal(entry.score100)
        ? current.score100
        : entry.score100;
    return [
      { mediaId: item.mediaId, malId: item.malId, to: service, entry: { ...entry, score100 } },
    ];
  });
}

/** How both lists end up after copying to `to` */
function outcome(item: SyncCandidate, to: Domain): string {
  const changes = changesFor(item, to);
  return SERVICES.map((service) =>
    signature(changes.find((change) => change.to === service)?.entry ?? item[service], true)
  ).join('|');
}

/**
 * Where to copy an anime by default: from the list where it changed last. AniList counts any edit
 * as a change, a new score or note included, so with the same status on both lists, the list that's
 * ahead on episodes is copied instead, rather than taking episodes back off the other. When the
 * lists only differ by a score or a date one of them hasn't got, either way ends the same, and the
 * entry that has it is the one suggested, so what's kept is what's shown
 */
function suggestTarget(item: SyncCandidate): Domain {
  const { anilist, myanimelist } = item;
  if (!anilist) return 'anilist';
  if (!myanimelist) return 'myanimelist';
  const aniListNewer = (anilist.updatedAt ?? 0) >= (myanimelist.updatedAt ?? 0);
  const newerIsBehind =
    anilist.status === myanimelist.status &&
    (aniListNewer
      ? anilist.progress < myanimelist.progress
      : myanimelist.progress < anilist.progress);
  const suggested: Domain = aniListNewer !== newerIsBehind ? 'myanimelist' : 'anilist';
  const other = otherService(suggested);
  // Kept as it is: nothing filled in from the other list
  const keptAsIs = (to: Domain) =>
    signature(combined(item, allFrom(otherService(to))), true) ===
    signature(item[otherService(to)], true);
  return !keptAsIs(suggested) &&
    keptAsIs(other) &&
    outcome(item, suggested) === outcome(item, other)
    ? other
    : suggested;
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
    return [{ ...candidate, to: suggestTarget(candidate) }];
  });
}

const DATE_NAMES = { startedAt: 'start date', completedAt: 'finish date' } as const;

/** A score as the service keeps it, out of 10: MyAnimeList in whole numbers */
export function scoreText(score100: number, service: Domain): string {
  const score = service === 'myanimelist' ? score100ToMal(score100) : score100 / 10;
  return `${Number(score.toFixed(1))}/10`;
}

/** What a write changes on its list, in words: "adds the start date 2025-06-20" */
function describeWrite(service: Domain, entry: SyncEntry, current: SyncEntry | null): string {
  const status = (value: string) => LIST_NAMES[service][value] ?? value;
  const score = scoreText(entry.score100, service);
  if (!current) {
    return [
      `adds it as ${status(entry.status)}`,
      `episode ${entry.progress}`,
      entry.score100 && `scored ${score}`,
      entry.startedAt && `started ${entry.startedAt}`,
      entry.completedAt && `finished ${entry.completedAt}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  const changes: string[] = [];
  if (entry.status !== current.status) {
    changes.push(`${status(current.status)} → ${status(entry.status)}`);
  }
  if (entry.progress !== current.progress) {
    changes.push(`episode ${current.progress} → ${entry.progress}`);
  }
  const before = scoreText(current.score100, service);
  if (score !== before) {
    changes.push(current.score100 ? `score ${before} → ${score}` : `adds the score ${score}`);
  }
  for (const field of ['startedAt', 'completedAt'] as const) {
    const [was, now] = [current[field], entry[field]];
    if (was === now) continue;
    const name = DATE_NAMES[field];
    changes.push(
      now ? (was ? `${name} ${was} → ${now}` : `adds the ${name} ${now}`) : `clears the ${name}`
    );
  }
  return changes.join(', ');
}

/** What syncing an anime as chosen changes on each list, in words, for the lists it changes */
export function describeChanges(
  item: SyncCandidate,
  choice: SyncChoice
): { service: Domain; text: string }[] {
  return changesFor(item, choice).map(({ to: service, entry }) => ({
    service,
    text: describeWrite(service, entry, item[service]),
  }));
}

/** An anime in an import file: the entry to write, and whether it's already on that list */
export type ImportEntry = { malId: number; title: string; entry: SyncEntry; update: boolean };

/** What each site's import file holds, and the anime kept out of AniList's */
export type ImportFiles = Record<Domain, ImportEntry[]> & {
  /**
   * Anime whose AniList score, now or once synced, is finer than whole points out of 10, which the
   * file can't hold: importing it, or undoing that, would round the score, so they're left out of
   * AniList's file
   */
  held: number[];
  /**
   * Each site's undo file: the anime its file updates, as that site has them now. Imported the
   * same way, it puts them back. It can't take off anime the file adds, as an import never removes
   */
  undo: Record<Domain, ImportEntry[]>;
};

/**
 * The import files that make the lists agree, as each anime is chosen to be synced (by MyAnimeList
 * id: how, or skip), and the files that undo them. Each entry carries the target's own notes, tags
 * and rewatch count, so a file that overwrites an entry keeps them
 */
export function importFiles(
  items: SyncItem[],
  choices: Record<number, SyncChoice | 'skip'>
): ImportFiles {
  const files: ImportFiles = {
    anilist: [],
    myanimelist: [],
    held: [],
    undo: { anilist: [], myanimelist: [] },
  };
  for (const item of items) {
    const to = choices[item.malId];
    if (!to || to === 'skip') continue;
    for (const { to: service, entry } of changesFor(item, to)) {
      const target = item[service];
      const fine = (score100: number) => score100 % 10 !== 0;
      if (service === 'anilist' && (fine(entry.score100) || fine(target?.score100 ?? 0))) {
        files.held.push(item.malId);
        continue;
      }
      const { malId, title } = item;
      files[service].push({
        malId,
        title,
        entry: { ...entry, extras: target?.extras },
        update: target !== null,
      });
      if (target) files.undo[service].push({ malId, title, entry: target, update: true });
    }
  }
  return files;
}

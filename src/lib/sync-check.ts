/**
 * What this browser knows of how a signed-in user's AniList and MyAnimeList lists differ, so their
 * own list can say when the lists drift apart without comparing them on every visit
 */
export type SyncCheck = {
  /** When the lists were last compared, as Unix time in ms; 0 when never */
  checkedAt: number;
  /** How they differed then: each anime's differenceKey */
  keys: string[];
  /** The differences already reviewed or dismissed, which aren't mentioned again */
  seen: string[];
};

/** How often the lists are compared, at most, from the list page */
export const SYNC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const NEVER: SyncCheck = { checkedAt: 0, keys: [], seen: [] };

/** The pair of accounts compared, by their ids on each service */
export const syncAccount = (aniList: { id: number }, myAnimeList: { id: number }) =>
  `${aniList.id}-${myAnimeList.id}`;

/** One record per pair of accounts, so another person signed in here doesn't see someone else's */
const storageKey = (account: string) => `yousoro:sync-check:${account}`;

const isKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 10_000 && value.every((key) => typeof key === 'string');

/** What's stored for the accounts, or a record of never having compared them */
export function loadSyncCheck(account: string): SyncCheck {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(account)) ?? 'null');
    if (Number.isFinite(stored?.checkedAt) && isKeys(stored.keys) && isKeys(stored.seen)) {
      return { checkedAt: stored.checkedAt, keys: stored.keys, seen: stored.seen };
    }
  } catch {
    // Storage may be blocked or full; the lists are then compared as if never before
  }
  return NEVER;
}

/**
 * Whether this browser can keep the record. Without it, the lists would be compared again on every
 * visit, and a dismissed notice would come back, so they're not compared at all
 */
export function canKeepSyncCheck(): boolean {
  const probe = 'yousoro:sync-check:probe';
  try {
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function saveSyncCheck(account: string, check: SyncCheck) {
  try {
    localStorage.setItem(storageKey(account), JSON.stringify(check));
  } catch {
    // Without storage, the next visit compares the lists again
  }
}

/** Whether it's time to compare the lists again; a clock set back counts as time */
export function shouldCheck(check: SyncCheck, now: number): boolean {
  return now - check.checkedAt >= SYNC_CHECK_INTERVAL_MS || now < check.checkedAt;
}

/** The differences not yet reviewed or dismissed */
export function unseen(check: SyncCheck): string[] {
  const seen = new Set(check.seen);
  return check.keys.filter((key) => !seen.has(key));
}

/**
 * The record after comparing the lists again. Differences that are gone are forgotten, so the
 * record holds only what's current
 */
export function afterCheck(check: SyncCheck, keys: string[], now: number): SyncCheck {
  const current = new Set(keys);
  return { checkedAt: now, keys, seen: check.seen.filter((key) => current.has(key)) };
}

/** The record once every current difference has been reviewed, as on the sync page */
export function reviewed(keys: string[], now: number): SyncCheck {
  return { checkedAt: now, keys, seen: keys };
}

import { createHash } from 'node:crypto';

// Best-effort guards for this instance only; replicas and cold starts have independent counters.
const counters = new Map<string, { count: number; expiresAt: number }>();
const MAX_COUNTERS = 1000;
let cooldownUntil = 0;

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function takeLimit(key: string, limit: number, seconds = 60, cost = 1) {
  const now = Date.now();
  let counter = counters.get(key);
  if (counter && counter.expiresAt <= now) {
    counters.delete(key);
    counter = undefined;
  }
  if (!counter) {
    if (counters.size >= MAX_COUNTERS) {
      for (const [entry, value] of counters) {
        if (value.expiresAt <= now) counters.delete(entry);
      }
      // Preserve active limits rather than allowing arbitrary keys to evict them.
      if (counters.size >= MAX_COUNTERS) return { allowed: false, retryAfter: seconds };
    }
    counter = { count: 0, expiresAt: now + seconds * 1000 };
    counters.set(key, counter);
  }
  const retryAfter = Math.max(1, Math.ceil((counter.expiresAt - now) / 1000));
  if (counter.count + cost > limit) return { allowed: false, retryAfter };
  counter.count += cost;
  return { allowed: true, retryAfter };
}

/**
 * How much of the outbound budget a request may use. Optional ones (social matches, decorative
 * airings and syncs) leave five slots for lists and progress saves; spare ones (taste comparisons,
 * which anyone can start by sharing a link) leave ten, so a link going around can't crowd out the
 * rest
 */
export type RequestPriority = 'required' | 'optional' | 'spare';
// AniList allows 30 requests a minute while its API is degraded, and 90 otherwise
const ANILIST_BUDGET: Record<RequestPriority, number> = { required: 25, optional: 20, spare: 15 };

export async function takeAniListRequest(priority: RequestPriority = 'required') {
  const retryAfter = Math.ceil((cooldownUntil - Date.now()) / 1000);
  if (retryAfter > 0) return { allowed: false, retryAfter };
  return takeLimit('anilist', ANILIST_BUDGET[priority]);
}

export async function pauseAniList(seconds: number) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + seconds * 1000);
}

// MyAnimeList doesn't publish its limits, and blocks clients it thinks send too many requests.
// Developers report about one request a second is safe, so its budget stays just under that, shared
// out like AniList's: a sync gives way to lists and progress saves. When MyAnimeList asks to slow
// down anyway, it's paused (see pauseMal)
const MAL_BUDGET: Record<RequestPriority, number> = { required: 50, optional: 40, spare: 30 };
let malCooldownUntil = 0;

export async function takeMalRequest(priority: RequestPriority = 'required') {
  const retryAfter = Math.ceil((malCooldownUntil - Date.now()) / 1000);
  if (retryAfter > 0) return { allowed: false, retryAfter };
  return takeLimit('myanimelist', MAL_BUDGET[priority]);
}

export async function pauseMal(seconds: number) {
  malCooldownUntil = Math.max(malCooldownUntil, Date.now() + seconds * 1000);
}

// Reads include navigation, preloads, and refreshes after saves. Keep them independent of writes.
const CLIENT_LIMITS = { read: 60, write: 20, auth: 10 } as const;
export function takeClientLimit(address: string, kind: keyof typeof CLIENT_LIMITS, cost = 1) {
  return takeLimit(`${kind}:${fingerprint(address)}`, CLIENT_LIMITS[kind], 60, cost);
}

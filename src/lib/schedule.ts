import type { ScheduleResult } from '#lib/types/schedule.js';

const cache = new Map<string, { result: ScheduleResult; reuseUntil: number; expiresAt: number }>();
const pending = new Map<string, Promise<ScheduleResult>>();
let retryAt = 0;
export const getScheduleRetryAt = () => retryAt;
/** Also enforce retention for fallback data that is already being displayed. */
export function scheduleExpired(result: ScheduleResult | null, now: number): boolean {
  return Boolean(
    result?.stale && result.fetchedAt !== undefined && now >= result.fetchedAt + 24 * 60 * 60 * 1000
  );
}
export class ScheduleUnavailable extends Error {
  constructor(
    message: string,
    public retryAt = 0
  ) {
    super(message);
  }
}

async function readBatch(
  batch: number[],
  from: number,
  until: number,
  refresh: boolean
): Promise<ScheduleResult> {
  const key = `${from}:${until}:${batch.join(',')}`;
  const cached = cache.get(key);
  if (
    cached &&
    cached.reuseUntil > Date.now() &&
    cached.expiresAt > Date.now() &&
    (!refresh || (!cached.result.partial && !cached.result.stale))
  )
    return cached.result;
  const fallback = () => {
    if (!cached || cached.expiresAt <= Date.now()) return null;
    const result = { ...cached.result, stale: true };
    cache.set(key, { ...cached, result, reuseUntil: Date.now() + 30_000 });
    return result;
  };
  if (Date.now() < retryAt) {
    const saved = fallback();
    if (saved) return saved;
    throw new ScheduleUnavailable('AniList is busy. Please wait before retrying.', retryAt);
  }
  const previous = pending.get(key);
  if (previous) return previous;
  const request = fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaIds: batch, from, until }),
  })
    .then(async (response) => {
      const retry = response.headers.get('Retry-After');
      let seconds = retry
        ? /^\d+$/.test(retry)
          ? Number(retry)
          : Math.ceil((Date.parse(retry) - Date.now()) / 1000)
        : 0;
      if (response.status === 429 && !(seconds > 0)) seconds = 60;
      if (seconds > 0) retryAt = Math.max(retryAt, Date.now() + Math.min(seconds, 300) * 1000);
      if (!response.ok)
        throw new ScheduleUnavailable(
          'Could not load the full schedule. Your next known episodes are still shown.',
          retryAt
        );
      const data: ScheduleResult = await response.json();
      if (data.retryAfter)
        retryAt = Math.max(retryAt, Date.now() + Math.min(data.retryAfter, 300) * 1000);
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      const fetchedAt = data.fetchedAt ?? Date.now();
      cache.set(key, {
        result: { ...data, fetchedAt },
        reuseUntil:
          data.stale || (data.partial && data.partialReason !== 'limit')
            ? Date.now() + 30_000
            : fetchedAt + 60 * 60 * 1000,
        expiresAt: fetchedAt + 24 * 60 * 60 * 1000,
      });
      return { ...data, fetchedAt };
    })
    .catch((err) => {
      const saved = fallback();
      if (saved) return saved;
      throw err instanceof ScheduleUnavailable
        ? err
        : new ScheduleUnavailable(
            'Could not load the full schedule. Your next known episodes are still shown.'
          );
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** Public airing metadata only; no list titles, profiles, tokens or persistent storage. */
export async function loadSchedule(
  mediaIds: number[],
  from: number,
  until: number,
  refresh = false
): Promise<ScheduleResult> {
  const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
  const result: ScheduleResult = { episodes: [], partial: false };
  for (let start = 0; start < ids.length; start += 500) {
    let part: ScheduleResult;
    try {
      part = await readBatch(ids.slice(start, start + 500), from, until, refresh);
    } catch (err) {
      if (start === 0) throw err;
      return {
        ...result,
        partial: true,
        partialReason: 'unavailable',
        ...(retryAt > Date.now() ? { retryAfter: Math.ceil((retryAt - Date.now()) / 1000) } : {}),
      };
    }
    result.episodes.push(...part.episodes);
    result.partial ||= part.partial;
    if (part.stale) result.stale = true;
    if (part.fetchedAt)
      result.fetchedAt = Math.min(result.fetchedAt ?? part.fetchedAt, part.fetchedAt);
    if (part.partialReason)
      result.partialReason =
        result.partialReason === 'unavailable' ? 'unavailable' : part.partialReason;
    if (part.retryAfter) result.retryAfter = Math.max(result.retryAfter ?? 0, part.retryAfter);
  }
  return result;
}

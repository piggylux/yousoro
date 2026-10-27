import { error, json, type RequestEvent } from '@sveltejs/kit';

import { AniListRateLimitError, getUpcomingAirings } from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

export async function POST(event: RequestEvent) {
  const body = await event.request.json().catch(() => null);
  const ids: unknown = body?.mediaIds;
  const from: unknown = body?.from;
  const until: unknown = body?.until;
  const now = Math.floor(Date.now() / 1000);
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) ||
    typeof from !== 'number' ||
    typeof until !== 'number' ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(until) ||
    from < now - 8 * 86400 ||
    from > now + 86400 ||
    until <= from ||
    until - from > 29 * 86400
  ) {
    error(400, 'Provide up to 500 unique media IDs and a current four-week date range');
  }
  try {
    const limit = await takeClientLimit(event.getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    const result = await getUpcomingAirings(ids, from, until);
    if (result.retryAfter) event.locals.retryAfter = result.retryAfter;
    return json(result);
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      event.locals.retryAfter = err.retryAfter;
      error(429, err.message);
    }
    console.error('Could not load episode schedule', err);
    error(502, 'Episode schedule is unavailable, please try again');
  }
}

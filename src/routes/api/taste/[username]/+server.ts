import { json } from '@sveltejs/kit';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getTasteProfile,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import type { RequestHandler } from './$types';

/**
 * Kept by the CDN for an hour, and served stale for a day while it's read again, so however many
 * people compare themselves with a shared list, AniList is asked for it about once an hour. A
 * browser keeps it five minutes, for someone checking a match after scoring a few more anime
 */
const PROFILE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/**
 * Someone's taste profile, for comparing it with another in the browser. It's read anonymously
 * whoever asks, so it's the same for everyone and cached publicly (see hooks.server.ts)
 */
export const GET: RequestHandler = async ({ params, getClientAddress, locals }) => {
  const busy = (retryAfter: number) => {
    locals.retryAfter = Math.max(locals.retryAfter ?? 0, retryAfter);
    // Only this client, or only for now: never kept for anyone else
    return json(
      { message: 'AniList is busy, please try again shortly' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  };

  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return busy(limit.retryAfter);
  try {
    return json(await getTasteProfile(params.username), {
      headers: { 'Cache-Control': PROFILE_CACHE },
    });
  } catch (err) {
    if (err instanceof AniListRateLimitError) return busy(err.retryAfter);
    if (err instanceof AniListNotFoundError) {
      // Missing or private, which AniList doesn't tell apart; a new account may come soon
      return json(
        { message: `There's no public AniList list for ${params.username}` },
        { status: 404, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } }
      );
    }
    console.error('Could not read a taste profile', err);
    return json(
      { message: "AniList isn't answering right now, please try again in a moment" },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
};

import { json } from '@sveltejs/kit';

import { takeClientLimit } from '#lib/server/rate-limit.js';
import {
  readTasteProfile,
  TasteProfileBusyError,
  TasteProfileMissingError,
} from '#lib/server/taste.js';
import { DOMAIN_NAMES, isDomain } from '#lib/types/domain.js';

import type { RequestHandler } from './$types';

/**
 * Kept by the CDN for an hour, and served stale for a day while it's read again, so however many
 * people compare themselves with a shared list, its service is asked for it about once an hour. A
 * browser keeps it five minutes, for someone checking a match after scoring a few more anime
 */
const PROFILE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
/** Kept briefly, as a new account or a list made public may come soon */
const MISSING_CACHE = 'public, max-age=300, s-maxage=300';

/**
 * Someone's taste profile on AniList or MyAnimeList, for comparing it with another in the browser.
 * It's read anonymously whoever asks, so it's the same for everyone and cached publicly (see
 * hooks.server.ts)
 */
export const GET: RequestHandler = async ({ params, getClientAddress, locals }) => {
  if (!isDomain(params.domain)) {
    return json(
      { message: `Unknown service: ${params.domain}` },
      { status: 404, headers: { 'Cache-Control': MISSING_CACHE } }
    );
  }
  const domain = params.domain;
  const service = DOMAIN_NAMES[domain];
  const busy = (retryAfter: number) => {
    locals.retryAfter = Math.max(locals.retryAfter ?? 0, retryAfter);
    // Only this client, or only for now: never kept for anyone else
    return json(
      { message: `${service} is busy, please try again shortly` },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  };

  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return busy(limit.retryAfter);
  try {
    return json(await readTasteProfile({ domain, name: params.username }), {
      headers: { 'Cache-Control': PROFILE_CACHE },
    });
  } catch (err) {
    if (err instanceof TasteProfileBusyError) return busy(err.retryAfter);
    if (err instanceof TasteProfileMissingError) {
      // Missing or private, which neither service tells apart to everyone
      return json(
        { message: `There's no public ${service} list for ${params.username}` },
        { status: 404, headers: { 'Cache-Control': MISSING_CACHE } }
      );
    }
    console.error('Could not read a taste profile', err);
    return json(
      { message: `${service} isn't answering right now, please try again in a moment` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
};

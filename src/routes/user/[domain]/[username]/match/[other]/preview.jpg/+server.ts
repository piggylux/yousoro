import { error } from '@sveltejs/kit';

import { canCompare, pagePerson, parsePersonSegment, samePerson } from '#lib/match.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import {
  renderMatchInvitePreview,
  renderMatchPreview,
  renderSitePreview,
} from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import {
  readTasteProfile,
  TasteProfileBusyError,
  TasteProfileMissingError,
} from '#lib/server/taste.js';

import type { RequestHandler } from './$types';

const CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

/**
 * The image social sites and chat apps show for a shared match. Like a list's preview, it's cached
 * publicly and drawn from public lists only, and falls back to the site's preview for a few
 * minutes when a list can't be read. Nobody is compared with themselves: two names of one account
 * get that person's invitation instead
 */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  const owner = pagePerson(params.domain, params.username, MAL_ENABLED);
  const other = owner && parsePersonSegment(params.other, owner.domain);
  if (!owner || !other || !canCompare(other, MAL_ENABLED)) {
    error(404, `Unknown match: ${params.other}`);
  }
  const fallback = (cacheControl: string) => renderSitePreview(cacheControl, 'jpeg');

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read', 2);
  if (!limit.allowed) return fallback('no-store');
  try {
    const [a, b] = await Promise.all([readTasteProfile(owner), readTasteProfile(other)]);
    return await (samePerson(a, b)
      ? renderMatchInvitePreview(a, CACHE)
      : renderMatchPreview(a, b, CACHE));
  } catch (err) {
    if (!(err instanceof TasteProfileMissingError || err instanceof TasteProfileBusyError)) {
      console.error('Could not draw the match preview', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

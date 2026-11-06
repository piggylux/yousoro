import { error } from '@sveltejs/kit';

import { pagePerson } from '#lib/match.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import { renderMatchInvitePreview, renderSitePreview } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import {
  readTasteProfile,
  TasteProfileBusyError,
  TasteProfileMissingError,
} from '#lib/server/taste.js';

import type { RequestHandler } from './$types';

/**
 * The image shown for a link inviting anyone to compare their taste with someone's. Cached and
 * drawn like a list's preview, from the same taste profile the comparison reads
 */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  const owner = pagePerson(params.domain, params.username, MAL_ENABLED);
  if (!owner) error(404, `Unknown domain: ${params.domain}`);
  const fallback = (cacheControl: string) => renderSitePreview(cacheControl, 'jpeg');

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return fallback('no-store');
  try {
    return await renderMatchInvitePreview(
      await readTasteProfile(owner),
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    );
  } catch (err) {
    if (!(err instanceof TasteProfileMissingError || err instanceof TasteProfileBusyError)) {
      console.error('Could not draw the match invite preview', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

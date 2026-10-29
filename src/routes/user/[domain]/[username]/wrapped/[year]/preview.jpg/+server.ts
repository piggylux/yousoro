import { error } from '@sveltejs/kit';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getAnimeYear,
} from '#lib/server/anilist-client.js';
import { renderSitePreview, renderWrappedPreview } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';
import { parseWrappedYear } from '#lib/wrapped.js';

import type { RequestHandler } from './$types';

/**
 * The image social sites and chat apps show for a shared year in anime. Cached and drawn like a
 * list's preview, from the same year the page reads
 */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  const year = parseWrappedYear(params.year);
  if (year === null) error(404, `There's no year in anime for ${params.year}`);
  const fallback = (cacheControl: string) => renderSitePreview(cacheControl, 'jpeg');

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return fallback('no-store');
  try {
    return await renderWrappedPreview(
      await getAnimeYear(params.username, year),
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    );
  } catch (err) {
    if (!(err instanceof AniListNotFoundError || err instanceof AniListRateLimitError)) {
      console.error('Could not draw the year in anime preview', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

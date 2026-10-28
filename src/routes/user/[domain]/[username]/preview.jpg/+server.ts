import { error } from '@sveltejs/kit';

import { AniListNotFoundError, AniListRateLimitError } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { renderListPreview, renderSitePreview } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

import type { RequestHandler } from './$types';

/**
 * The image social sites and chat apps show for a shared list. It's cached publicly, so it's always
 * drawn from the public list, never with the signed-in viewer's token. A list that can't be read
 * gets the site's preview for a few minutes, so a busy AniList doesn't stick to the link
 */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  const fallback = (cacheControl: string) => renderSitePreview(cacheControl, 'jpeg');

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return fallback('no-store');
  try {
    const list = await new AniListApi().getUserAnimeList(params.username, false);
    return await renderListPreview(
      list,
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    );
  } catch (err) {
    if (!(err instanceof AniListNotFoundError || err instanceof AniListRateLimitError)) {
      console.error('Could not draw the list preview', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

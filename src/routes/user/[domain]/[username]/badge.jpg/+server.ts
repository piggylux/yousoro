import { error } from '@sveltejs/kit';

import { AniListNotFoundError, AniListRateLimitError } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { renderBadge, type BadgeTheme } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDomain } from '#lib/types/domain.js';

import type { RequestHandler } from './$types';

/**
 * A badge people put on their AniList profile or anywhere else that shows images, so every visit
 * to the page it's on reads it. It's drawn from the public list and cached like a list's preview,
 * which keeps AniList to about one read an hour per badge however often it's seen. Those reads give
 * way first when AniList is busy, so badges never crowd out lists and progress saves. A list that
 * can't be read gets a badge of the site for a few minutes, so a busy AniList doesn't stick to it
 */
export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  const theme: BadgeTheme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const fallback = (cacheControl: string) => renderBadge(null, theme, cacheControl);

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return fallback('no-store');
  try {
    const list = await new AniListApi().getUserAnimeList(params.username, false, 'spare');
    return await renderBadge(
      list,
      theme,
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    );
  } catch (err) {
    if (!(err instanceof AniListNotFoundError || err instanceof AniListRateLimitError)) {
      console.error('Could not draw the badge', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

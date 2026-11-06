import { error } from '@sveltejs/kit';

import { isUserName, pagePerson } from '#lib/match.js';
import { AniListNotFoundError, AniListRateLimitError } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { MAL_ENABLED } from '#lib/server/myanimelist-auth.js';
import {
  MalForbiddenError,
  MalNotFoundError,
  MalRateLimitError,
} from '#lib/server/myanimelist-client.js';
import { MyAnimeListApi } from '#lib/server/myanimelist.js';
import { renderBadge, type BadgeTheme } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import type { RequestHandler } from './$types';

/** Why a list can't be read for a while, which needs no log: it's missing, private, or busy */
const EXPECTED_ERRORS = [
  AniListNotFoundError,
  AniListRateLimitError,
  MalNotFoundError,
  MalForbiddenError,
  MalRateLimitError,
];

/**
 * A badge people put on their AniList or MyAnimeList profile or anywhere else that shows images,
 * so every visit to the page it's on reads it. It's drawn from the public list and cached like a
 * list's preview, which keeps its service to about one read an hour per badge however often it's
 * seen. Those reads give way first when a service is busy, so badges never crowd out lists and
 * progress saves. A list that can't be read gets a badge of the site for a few minutes, so a busy
 * service doesn't stick to it
 */
export const GET: RequestHandler = async ({ params, url, getClientAddress }) => {
  const owner = pagePerson(params.domain, params.username, MAL_ENABLED);
  if (!owner) error(404, `Unknown domain: ${params.domain}`);
  const theme: BadgeTheme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const fallback = (cacheControl: string) => renderBadge(null, theme, cacheControl);

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read');
  if (!limit.allowed) return fallback('no-store');
  try {
    // Any name can be asked for, and one that can't exist would still spend a request
    if (owner.domain === 'myanimelist' && !isUserName(owner.name)) {
      throw new MalNotFoundError(`No MyAnimeList user named ${owner.name}`);
    }
    const api = owner.domain === 'anilist' ? new AniListApi() : new MyAnimeListApi();
    const list = await api.getUserAnimeList(owner.name, false, 'spare');
    return await renderBadge(
      list,
      theme,
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
    );
  } catch (err) {
    if (!EXPECTED_ERRORS.some((expected) => err instanceof expected)) {
      console.error('Could not draw the badge', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

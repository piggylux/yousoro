import { error } from '@sveltejs/kit';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getTasteProfile,
} from '#lib/server/anilist-client.js';
import { renderGroupPreview, renderSitePreview } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { groupNames } from '#lib/together.js';

import type { RequestHandler } from './$types';

const CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

/**
 * The image social sites and chat apps show for a group's link. Like a match's preview, it's cached
 * publicly and drawn from public lists only, and falls back to the site's preview for a few minutes
 * when AniList can't be read. As on the page, a missing or private list is left out of the group,
 * and two names of one account are one person
 */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  if (params.domain !== 'anilist') error(404, `Unknown domain: ${params.domain}`);
  const fallback = (cacheControl: string) => renderSitePreview(cacheControl, 'jpeg');
  const names = [params.username, ...groupNames(params.username, params.others)];

  // Only this client is over its limit, so the fallback must not be cached for everyone else
  const limit = await takeClientLimit(getClientAddress(), 'read', names.length);
  if (!limit.allowed) return fallback('no-store');
  try {
    const profiles = await Promise.all(
      names.map((name) =>
        getTasteProfile(name).catch((err) => {
          if (err instanceof AniListNotFoundError) return null;
          throw err;
        })
      )
    );
    const people = profiles.filter(
      (profile, index): profile is NonNullable<typeof profile> =>
        profile !== null && profiles.findIndex((other) => other?.id === profile.id) === index
    );
    if (!people.length) return fallback('public, max-age=300, s-maxage=300');
    return await renderGroupPreview(people, CACHE);
  } catch (err) {
    if (!(err instanceof AniListNotFoundError || err instanceof AniListRateLimitError)) {
      console.error('Could not draw the group preview', err);
    }
    return fallback('public, max-age=300, s-maxage=300');
  }
};

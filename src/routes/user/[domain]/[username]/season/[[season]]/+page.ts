import { error } from '@sveltejs/kit';

import { defaultSeason, parseSeasonSlug } from '#lib/anime-search.js';
import { isDomain } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * Only which season and whose list: the season's anime are asked for from the browser, straight to
 * AniList, which a load would also do on the server, and the owner's taste is read once in the tab,
 * whichever season is shown. Without a season, the one worth looking at now, so a link to the page
 * always opens on it
 */
export const load: PageLoad = async ({ params, parent }) => {
  const { malEnabled } = await parent();
  const { domain, username } = params;
  if (!isDomain(domain) || (domain === 'myanimelist' && !malEnabled)) {
    error(404, `Unknown domain: ${domain}`);
  }
  const season = params.season === undefined ? defaultSeason() : parseSeasonSlug(params.season);
  if (!season) error(404, `There's no anime season called ${params.season}`);
  return { domain, username, season };
};

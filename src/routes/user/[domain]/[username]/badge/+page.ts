import { error } from '@sveltejs/kit';

import { isUserName, pagePerson } from '#lib/match.js';
import { DOMAIN_NAMES } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * The page never reads AniList or MyAnimeList itself: the badge it shows is drawn and cached by
 * badge.jpg, so a name that's missing or private gets the site's badge there rather than an error
 * here
 */
export const load: PageLoad = async ({ params, parent }) => {
  const { malEnabled } = await parent();
  const owner = pagePerson(params.domain, params.username, malEnabled);
  if (!owner) error(404, `Unknown domain: ${params.domain}`);
  if (!isUserName(owner.name)) {
    error(404, `There's no ${DOMAIN_NAMES[owner.domain]} user named ${owner.name}`);
  }
  return { owner };
};

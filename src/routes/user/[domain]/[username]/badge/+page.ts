import { error } from '@sveltejs/kit';

import { isUserName } from '#lib/match.js';

import type { PageLoad } from './$types';

/**
 * The page never reads AniList itself: the badge it shows is drawn and cached by badge.jpg, so a
 * name that's missing or private gets the site's badge there rather than an error here
 */
export const load: PageLoad = ({ params }) => {
  if (params.domain !== 'anilist') error(404, `Unknown domain: ${params.domain}`);
  if (!isUserName(params.username)) error(404, `There's no AniList user named ${params.username}`);
  return { name: params.username };
};

import { error, redirect } from '@sveltejs/kit';

import { isUserName } from '#lib/match.js';
import { isDomain } from '#lib/types/domain.js';
import { parseWrappedYear, wrappedPath, wrappedYear } from '#lib/wrapped.js';

import type { PageLoad } from './$types';

/**
 * Like a match, the page never waits on AniList: the year is read in the browser, from what the CDN
 * keeps (see /api/wrapped). Without a year, it goes to the one to sum up, so a shared link names
 * its year and still shows it once the next one starts
 */
export const load: PageLoad = ({ params }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  if (!isUserName(params.username)) error(404, `There's no AniList user named ${params.username}`);
  if (!params.year) redirect(307, wrappedPath(params.username, wrappedYear(new Date())));
  const year = parseWrappedYear(params.year);
  if (year === null) error(404, `There's no year in anime for ${params.year}`);
  return { name: params.username, year };
};

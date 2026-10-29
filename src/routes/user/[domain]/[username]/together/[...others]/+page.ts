import { error, redirect } from '@sveltejs/kit';

import { parseUserName } from '#lib/match.js';
import { groupNames, MAX_GROUP, togetherPath } from '#lib/together.js';
import { isDomain } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * Like a match, the page never waits on AniList: everyone's lists are read in the browser, from
 * profiles the CDN keeps (see /api/taste). A name typed in the form arrives as `?add=`, and a
 * signed-in viewer opening someone's invitation joins it right away. A path with repeated names,
 * names that can't be AniList's, or too many goes to the group it describes
 */
export const load: PageLoad = async ({ params, parent, url }) => {
  if (!isDomain(params.domain)) error(404, `Unknown domain: ${params.domain}`);
  const host = params.username;
  const others = groupNames(host, params.others);
  const page = { host, others, formError: null as 'invalid' | 'full' | null, typed: '' };
  const isMember = (name: string) =>
    [host, ...others].some((member) => member.toLowerCase() === name.toLowerCase());

  // A name typed in the form on an untidy path is still added, once there
  if (others.join('/') !== params.others)
    redirect(307, `${togetherPath(host, others)}${url.search}`);

  const typed = url.searchParams.get('add');
  if (typed !== null) {
    const name = parseUserName(typed);
    if (!name) return { ...page, formError: 'invalid' as const, typed };
    // Already in the group: nothing to add
    if (isMember(name)) redirect(303, togetherPath(host, others));
    if (others.length + 1 >= MAX_GROUP) return { ...page, formError: 'full' as const, typed };
    redirect(303, togetherPath(host, [...others, name]));
  }

  const { user } = await parent();
  if (user && !others.length && !isMember(user.name)) {
    redirect(307, togetherPath(host, [user.name]));
  }
  return page;
};

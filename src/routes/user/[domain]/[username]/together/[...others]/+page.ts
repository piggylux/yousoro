import { error, redirect } from '@sveltejs/kit';

import {
  canCompare,
  pagePerson,
  parsePerson,
  personSegment,
  sameName,
  viewerAccounts,
} from '#lib/match.js';
import { groupMembers, MAX_GROUP, togetherPath } from '#lib/together.js';
import type { ListOwner } from '#lib/types/domain.js';

import type { PageLoad } from './$types';

/**
 * Like a match, the page never waits on AniList or MyAnimeList: everyone's lists are read in the
 * browser, from profiles the CDN keeps (see /api/taste). A name typed in the form arrives as
 * `?add=`, and a signed-in viewer opening someone's invitation joins it right away, with their
 * account on the host's service when they have one. A path with repeated people, names that can't
 * be anyone's, or too many goes to the group it describes
 */
export const load: PageLoad = async ({ params, parent, url }) => {
  const { user, malUser, malEnabled } = await parent();
  const host = pagePerson(params.domain, params.username, malEnabled);
  if (!host) error(404, `Unknown domain: ${params.domain}`);
  const others = groupMembers(host, params.others).filter((other) => canCompare(other, malEnabled));
  const page = { host, others, formError: null as 'invalid' | 'full' | null, typed: '' };
  const isMember = (person: ListOwner) =>
    [host, ...others].some((member) => sameName(member, person));

  // A name typed in the form on an untidy path is still added, once there
  const tidy = others.map((other) => decodeURIComponent(personSegment(other, host.domain)));
  if (tidy.join('/') !== params.others) redirect(307, `${togetherPath(host, others)}${url.search}`);

  const typed = url.searchParams.get('add');
  if (typed !== null) {
    const person = parsePerson(typed, host.domain);
    if (!person || !canCompare(person, malEnabled)) {
      return { ...page, formError: 'invalid' as const, typed };
    }
    // Already in the group: nothing to add
    if (isMember(person)) redirect(303, togetherPath(host, others));
    if (others.length + 1 >= MAX_GROUP) return { ...page, formError: 'full' as const, typed };
    redirect(303, togetherPath(host, [...others, person]));
  }

  const viewer = viewerAccounts(user, malUser, host.domain);
  if (viewer.length && !others.length && !viewer.some(isMember)) {
    redirect(307, togetherPath(host, [viewer[0]]));
  }
  return page;
};

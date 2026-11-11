import { DOMAIN_NAMES, type Domain, listPath } from '#lib/types/domain.js';
import type { SessionUser } from '#lib/types/session-user.js';
import { wrappedPath } from '#lib/wrapped.js';

export type SignedInAccount = { domain: Domain; user: SessionUser };
/** Whose list it is, on which service */
export type ListOwner = { domain: Domain; name: string };

/** Every account signed in, the main list's first */
export function signedInAccounts(
  user: SessionUser | null,
  malUser: SessionUser | null,
  mainList: Domain
): SignedInAccount[] {
  return [
    ...(user ? [{ domain: 'anilist' as const, user }] : []),
    ...(malUser ? [{ domain: 'myanimelist' as const, user: malUser }] : []),
  ].sort((a, b) => Number(b.domain === mainList) - Number(a.domain === mainList));
}

/** The list the header's tabs lead to: the main signed-in account's, or else the one being looked at */
export function headerList(
  accounts: SignedInAccount[],
  viewed: ListOwner | null
): ListOwner | null {
  const main = accounts[0];
  return main ? { domain: main.domain, name: main.user.name } : viewed;
}

/** Service names match whatever their case, so a typed URL still finds the same list */
function sameList(a: ListOwner, b: ListOwner) {
  return a.domain === b.domain && a.name.toLowerCase() === b.name.toLowerCase();
}

/**
 * The list owner's accounts to link to: the list's own, and on their own list, the other service's
 * they're signed in with. AniList's comes first wherever both show
 */
export function ownerProfiles(
  owner: ListOwner,
  ownList: boolean,
  accounts: SignedInAccount[]
): ListOwner[] {
  const other = ownList ? accounts.find(({ domain }) => domain !== owner.domain) : undefined;
  const profiles = other ? [owner, { domain: other.domain, name: other.user.name }] : [owner];
  return profiles.sort((a, b) => Number(b.domain === 'anilist') - Number(a.domain === 'anilist'));
}

export type ProfileLink = { href: string; label: string };

/**
 * A signed-in account's own pages for the account menu: its list and, on AniList, its friends.
 * The header's tabs lead to one account's list and friends, so that account needs neither here
 */
export function accountMenuLinks(account: ListOwner, header: ListOwner | null): ProfileLink[] {
  if (header && sameList(header, account)) return [];
  const path = listPath(account.domain, account.name);
  return [
    { href: path, label: `My ${DOMAIN_NAMES[account.domain]} list` },
    ...(account.domain === 'anilist' ? [{ href: `${path}/friends`, label: 'My friends' }] : []),
  ];
}

/**
 * The owner's other pages, for the menu beside the profile's actions. The header's tabs already lead
 * to the calendar, planning and friends of the list they're on, so those are only added here when
 * they lead to another list
 */
export function moreProfileLinks({
  owner,
  ownList,
  calendarView,
  header,
  year,
}: {
  owner: ListOwner;
  ownList: boolean;
  calendarView: boolean;
  header: ListOwner | null;
  /** The year the recap sums up */
  year: number;
}): ProfileLink[] {
  const path = listPath(owner.domain, owner.name);
  const onAniList = owner.domain === 'anilist';
  const links: ProfileLink[] = [];
  if (!header || !sameList(header, owner)) {
    links.push(
      calendarView
        ? { href: path, label: 'Anime list' }
        : { href: `${path}?view=calendar`, label: 'Calendar' },
      { href: `${path}/planning`, label: 'Planning' }
    );
    if (onAniList) links.push({ href: `${path}/friends`, label: 'Friends' });
  }
  if (onAniList) {
    links.push({ href: wrappedPath(owner.name, year), label: `${year} in anime` });
    if (ownList) links.push({ href: `${path}/badge`, label: 'Profile badge' });
  }
  if (ownList) links.push({ href: HISTORY_PATH, label: 'Recent changes' });
  return links;
}

/** The changes the signed-in user made to their lists in this tab, to revert one */
export const HISTORY_PATH = '/history';

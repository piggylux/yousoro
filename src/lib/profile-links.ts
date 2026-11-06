import { type Domain, listPath } from '#lib/types/domain.js';
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

/**
 * Whose friends the header's Friends tab leads to: the signed-in AniList account's, even when the
 * main list is on MyAnimeList, or else those of the AniList list being looked at. Null when there
 * are none, as friends are the people someone follows on AniList
 */
export function friendsList(
  accounts: SignedInAccount[],
  header: ListOwner | null
): ListOwner | null {
  const aniList = accounts.find(({ domain }) => domain === 'anilist');
  if (aniList) return { domain: 'anilist', name: aniList.user.name };
  return header?.domain === 'anilist' ? header : null;
}

/** The viewer's accounts on both services, when they're signed in to both */
export type LinkedAccounts = {
  /** The main account's list, where both lists show as one */
  main: ListOwner;
  aniListName: string;
  malName: string;
};

/**
 * The viewer's accounts when they're signed in to both services and the list is one of theirs: the
 * two lists then show as one, at the main account's address. Null for anyone else's list, or when
 * the viewer has only one account
 */
export function linkedAccounts(
  owner: ListOwner,
  accounts: SignedInAccount[]
): LinkedAccounts | null {
  const aniList = accounts.find(({ domain }) => domain === 'anilist');
  const mal = accounts.find(({ domain }) => domain === 'myanimelist');
  if (!aniList || !mal) return null;
  const own = accounts.some(({ domain, user }) => sameList(owner, { domain, name: user.name }));
  if (!own) return null;
  const [main] = accounts;
  return {
    main: { domain: main.domain, name: main.user.name },
    aniListName: aniList.user.name,
    malName: mal.user.name,
  };
}

export type ProfileLink = { href: string; label: string };

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
  aniListName,
}: {
  owner: ListOwner;
  ownList: boolean;
  calendarView: boolean;
  header: ListOwner | null;
  /** The year the recap sums up */
  year: number;
  /**
   * The owner's AniList name, which friends, recaps and badges belong to: the list's own on
   * AniList, their AniList account's on a combined list, and null otherwise
   */
  aniListName: string | null;
}): ProfileLink[] {
  const path = listPath(owner.domain, owner.name);
  const aniListPath = aniListName === null ? null : listPath('anilist', aniListName);
  const links: ProfileLink[] = [];
  if (!header || !sameList(header, owner)) {
    links.push(
      calendarView
        ? { href: path, label: 'Anime list' }
        : { href: `${path}?view=calendar`, label: 'Calendar' },
      { href: `${path}/planning`, label: 'Planning' }
    );
    if (aniListPath) links.push({ href: `${aniListPath}/friends`, label: 'Friends' });
  }
  if (aniListName !== null && aniListPath) {
    links.push({ href: wrappedPath(aniListName, year), label: `${year} in anime` });
    if (ownList) links.push({ href: `${aniListPath}/badge`, label: 'Profile badge' });
  }
  return links;
}

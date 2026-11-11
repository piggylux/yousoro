import { describe, expect, it } from 'vitest';

import {
  accountMenuLinks,
  headerList,
  moreProfileLinks,
  ownerProfiles,
  signedInAccounts,
  type ListOwner,
} from '#lib/profile-links.js';
import { profileUrl } from '#lib/types/domain.js';

const aniUser = { id: 1, name: 'Viewer', avatarUrl: null };
const malUser = { id: 2, name: 'ViewerMal', avatarUrl: null };
const sylux: ListOwner = { domain: 'anilist', name: 'Sylux' };

function labels(...args: Parameters<typeof moreProfileLinks>) {
  return moreProfileLinks(...args).map(({ label }) => label);
}

describe('signed-in accounts', () => {
  it('puts the main list first', () => {
    expect(signedInAccounts(aniUser, malUser, 'myanimelist').map(({ domain }) => domain)).toEqual([
      'myanimelist',
      'anilist',
    ]);
    expect(signedInAccounts(null, malUser, 'anilist').map(({ domain }) => domain)).toEqual([
      'myanimelist',
    ]);
  });

  it('leads the header to the main account, or else to the list being looked at', () => {
    expect(headerList(signedInAccounts(aniUser, malUser, 'myanimelist'), sylux)).toEqual({
      domain: 'myanimelist',
      name: 'ViewerMal',
    });
    expect(headerList([], sylux)).toBe(sylux);
  });
});

describe('owner profiles', () => {
  const both = signedInAccounts(aniUser, malUser, 'myanimelist');

  it("links only the list's own service on someone else's list", () => {
    expect(ownerProfiles(sylux, false, both)).toEqual([sylux]);
  });

  it('adds the other signed-in account on your own list, AniList first', () => {
    expect(ownerProfiles({ domain: 'myanimelist', name: 'ViewerMal' }, true, both)).toEqual([
      { domain: 'anilist', name: 'Viewer' },
      { domain: 'myanimelist', name: 'ViewerMal' },
    ]);
    expect(ownerProfiles({ domain: 'anilist', name: 'Viewer' }, true, both.slice(1))).toEqual([
      { domain: 'anilist', name: 'Viewer' },
    ]);
  });

  it("opens each service's profile page", () => {
    expect(profileUrl('anilist', 'A B')).toBe('https://anilist.co/user/A%20B/');
    expect(profileUrl('myanimelist', 'Xinil')).toBe('https://myanimelist.net/profile/Xinil');
  });
});

describe('more profile links', () => {
  const base = { owner: sylux, ownList: false, calendarView: false, year: 2026 };

  it("leaves out the pages the header's tabs already lead to", () => {
    expect(labels({ ...base, header: sylux })).toEqual(['2026 in anime']);
    expect(labels({ ...base, header: { domain: 'anilist', name: 'SYLUX' } })).toEqual([
      '2026 in anime',
    ]);
  });

  it("adds the owner's own pages when the header leads to another list", () => {
    const header = { domain: 'anilist', name: 'Viewer' } as const;
    expect(moreProfileLinks({ ...base, header })).toEqual([
      { href: '/user/anilist/Sylux?view=calendar', label: 'Calendar' },
      { href: '/user/anilist/Sylux/planning', label: 'Planning' },
      { href: '/user/anilist/Sylux/friends', label: 'Friends' },
      { href: '/user/anilist/Sylux/wrapped/2026', label: '2026 in anime' },
    ]);
    expect(labels({ ...base, calendarView: true, header })[0]).toBe('Anime list');
  });

  it('offers the profile badge and the recent changes on your own list', () => {
    expect(labels({ ...base, ownList: true, header: sylux })).toEqual([
      '2026 in anime',
      'Profile badge',
      'Recent changes',
    ]);
    expect(moreProfileLinks({ ...base, ownList: true, header: sylux }).at(-1)).toEqual({
      href: '/history',
      label: 'Recent changes',
    });
  });

  it('keeps AniList-only pages off MyAnimeList lists', () => {
    const owner = { domain: 'myanimelist', name: 'Xinil' } as const;
    expect(labels({ ...base, owner, header: owner })).toEqual([]);
    expect(labels({ ...base, owner, header: sylux })).toEqual(['Calendar', 'Planning']);
    expect(labels({ ...base, owner, ownList: true, header: owner })).toEqual(['Recent changes']);
  });
});

describe('account menu links', () => {
  const ani = { domain: 'anilist', name: 'Viewer' } as const;
  const mal = { domain: 'myanimelist', name: 'ViewerMal' } as const;

  it("leaves out the account whose list and friends the header's tabs lead to", () => {
    expect(accountMenuLinks(ani, ani)).toEqual([]);
    expect(accountMenuLinks(ani, { domain: 'anilist', name: 'VIEWER' })).toEqual([]);
  });

  it("links the other account's list, and its friends on AniList", () => {
    expect(accountMenuLinks(mal, ani)).toEqual([
      { href: '/user/myanimelist/ViewerMal', label: 'My MyAnimeList list' },
    ]);
    expect(accountMenuLinks(ani, mal)).toEqual([
      { href: '/user/anilist/Viewer', label: 'My AniList list' },
      { href: '/user/anilist/Viewer/friends', label: 'My friends' },
    ]);
  });
});

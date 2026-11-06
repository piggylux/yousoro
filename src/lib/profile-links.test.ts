import { describe, expect, it } from 'vitest';

import {
  friendsList,
  headerList,
  linkedAccounts,
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
  const base = {
    owner: sylux,
    ownList: false,
    calendarView: false,
    year: 2026,
    aniListName: 'Sylux',
  };

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

  it('offers the profile badge on your own list', () => {
    expect(labels({ ...base, ownList: true, header: sylux })).toEqual([
      '2026 in anime',
      'Profile badge',
    ]);
  });

  it('keeps AniList-only pages off MyAnimeList lists', () => {
    const owner = { domain: 'myanimelist', name: 'Xinil' } as const;
    expect(labels({ ...base, owner, header: owner, aniListName: null })).toEqual([]);
    expect(labels({ ...base, owner, header: sylux, aniListName: null })).toEqual([
      'Calendar',
      'Planning',
    ]);
  });

  it("leads a combined MyAnimeList list's AniList pages to the owner's AniList account", () => {
    const owner = { domain: 'myanimelist', name: 'ViewerMal' } as const;
    expect(
      moreProfileLinks({ ...base, owner, ownList: true, header: owner, aniListName: 'Viewer' })
    ).toEqual([
      { href: '/user/anilist/Viewer/wrapped/2026', label: '2026 in anime' },
      { href: '/user/anilist/Viewer/badge', label: 'Profile badge' },
    ]);
  });
});

describe('linked accounts', () => {
  const ownMal = { domain: 'myanimelist', name: 'viewermal' } as const;

  it("combines the viewer's own lists, at the main account's address", () => {
    expect(linkedAccounts(ownMal, signedInAccounts(aniUser, malUser, 'anilist'))).toEqual({
      main: { domain: 'anilist', name: 'Viewer' },
      aniListName: 'Viewer',
      malName: 'ViewerMal',
    });
    expect(linkedAccounts(ownMal, signedInAccounts(aniUser, malUser, 'myanimelist'))?.main).toEqual(
      { domain: 'myanimelist', name: 'ViewerMal' }
    );
  });

  it("leaves anyone else's list, and a viewer with one account, as they are", () => {
    expect(linkedAccounts(sylux, signedInAccounts(aniUser, malUser, 'anilist'))).toBeNull();
    // The same name on the other service is someone else
    expect(
      linkedAccounts(
        { domain: 'myanimelist', name: 'Viewer' },
        signedInAccounts(aniUser, malUser, 'anilist')
      )
    ).toBeNull();
    expect(linkedAccounts(ownMal, signedInAccounts(null, malUser, 'anilist'))).toBeNull();
  });
});

describe('friends list', () => {
  it('leads to the signed-in AniList account, even when the main list is on MyAnimeList', () => {
    const accounts = signedInAccounts(aniUser, malUser, 'myanimelist');
    expect(friendsList(accounts, headerList(accounts, null))).toEqual({
      domain: 'anilist',
      name: 'Viewer',
    });
  });

  it("leads to the AniList list being looked at, and nowhere from MyAnimeList's alone", () => {
    expect(friendsList([], sylux)).toBe(sylux);
    const mal = signedInAccounts(null, malUser, 'anilist');
    expect(friendsList(mal, headerList(mal, sylux))).toBeNull();
  });
});

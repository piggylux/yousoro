import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { load } from './+page.js';

type Event = Parameters<typeof load>[0];

type Viewer = { mal?: string; malEnabled?: boolean };

function event(
  path: string,
  viewer: string | null = null,
  { mal, malEnabled = true }: Viewer = {}
) {
  const url = new URL(path, 'https://yousoro.test');
  const [, , domain, username, , other] = url.pathname.split('/');
  return {
    params: { domain, username, other: other && decodeURIComponent(other) },
    url,
    parent: async () => ({
      user: viewer ? { id: 1, name: viewer } : null,
      malUser: mal ? { id: 2, name: mal } : null,
      malEnabled,
    }),
  } as unknown as Event;
}

async function redirectOf(path: string, viewer: string | null = null, options: Viewer = {}) {
  try {
    await load(event(path, viewer, options));
  } catch (err) {
    if (isRedirect(err)) return err.location;
    throw err;
  }
  return null;
}

const alice = { domain: 'anilist', name: 'Alice' };

describe('match page', () => {
  it('compares a signed-in viewer with the person whose invitation they opened', async () => {
    expect(await redirectOf('/user/anilist/Alice/match', 'Bob')).toBe(
      '/user/anilist/Alice/match/Bob'
    );
  });

  it('shows the invitation to its owner and to visitors who are not signed in', async () => {
    expect(await redirectOf('/user/anilist/alice/match', 'Alice')).toBeNull();
    expect(await redirectOf('/user/anilist/Alice/match')).toBeNull();
  });

  it('opens the match for a name typed in the form, even for a signed-in viewer', async () => {
    expect(
      await redirectOf('/user/anilist/Alice/match?with=https://anilist.co/user/Carol/', 'Bob')
    ).toBe('/user/anilist/Alice/match/Carol');
  });

  it('stays on the form with the text when it cannot be a name', async () => {
    expect(await load(event('/user/anilist/Alice/match?with=two%20words', 'Bob'))).toEqual({
      owner: alice,
      other: null,
      invalidName: 'two words',
      same: false,
    });
  });

  it('never redirects a match that names both people', async () => {
    expect(await load(event('/user/anilist/Alice/match/Carol', 'Bob'))).toEqual({
      owner: alice,
      other: { domain: 'anilist', name: 'Carol' },
      invalidName: null,
      same: false,
    });
  });

  it('never compares anyone with themselves, whatever the case of the name', async () => {
    expect(await redirectOf('/user/anilist/Alice/match/ALICE', 'Bob')).toBe(
      '/user/anilist/Alice/match'
    );
    // Typed in the form, the invitation stays, with a note
    expect(await load(event('/user/anilist/Alice/match?with=@alice', 'Bob'))).toEqual({
      owner: alice,
      other: null,
      invalidName: null,
      same: true,
    });
  });
});

describe('a match with someone on MyAnimeList', () => {
  it('compares a viewer signed in to MyAnimeList only with their account there', async () => {
    expect(await redirectOf('/user/anilist/Alice/match', null, { mal: 'Mika' })).toBe(
      '/user/anilist/Alice/match/myanimelist:Mika'
    );
  });

  it("compares a viewer on both with their account on the invitation's service", async () => {
    expect(await redirectOf('/user/myanimelist/Sora/match', 'Alice', { mal: 'Mika' })).toBe(
      '/user/myanimelist/Sora/match/Mika'
    );
    // Their own invitation, whichever account it's from
    expect(await redirectOf('/user/myanimelist/mika/match', 'Alice', { mal: 'Mika' })).toBeNull();
  });

  it('opens a match with a MyAnimeList profile link typed in the form', async () => {
    expect(
      await redirectOf('/user/anilist/Alice/match?with=https://myanimelist.net/profile/Mika')
    ).toBe('/user/anilist/Alice/match/myanimelist:Mika');
    // The same name on the other service is someone else
    expect(await redirectOf('/user/myanimelist/Alice/match?with=anilist.co/user/Alice')).toBe(
      '/user/myanimelist/Alice/match/anilist:Alice'
    );
  });

  it("knows nobody on MyAnimeList while it isn't set up, or at a path naming no one", async () => {
    const off = { malEnabled: false };
    await expect(load(event('/user/myanimelist/Mika/match', null, off))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      load(event('/user/anilist/Alice/match/myanimelist:Mika', null, off))
    ).rejects.toMatchObject({ status: 404 });
    await expect(load(event('/user/anilist/Alice/match/kitsu:Mika'))).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await load(event('/user/anilist/Alice/match?with=myanimelist.net/profile/Mika', null, off))
    ).toMatchObject({ invalidName: 'myanimelist.net/profile/Mika' });
  });
});

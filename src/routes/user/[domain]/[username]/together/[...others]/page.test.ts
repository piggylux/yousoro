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
  const [, , domain, username, , ...others] = url.pathname.split('/');
  return {
    params: { domain, username, others: others.map(decodeURIComponent).join('/') },
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

describe('watch together page', () => {
  it('adds a signed-in viewer to the group whose invitation they opened', async () => {
    expect(await redirectOf('/user/anilist/Alice/together', 'Bob')).toBe(
      '/user/anilist/Alice/together/Bob'
    );
    expect(await redirectOf('/user/anilist/Alice/together', 'alice')).toBeNull();
    expect(await redirectOf('/user/anilist/Alice/together')).toBeNull();
  });

  it('never adds a viewer to a group someone already put together', async () => {
    expect(await redirectOf('/user/anilist/Alice/together/Carol', 'Bob')).toBeNull();
  });

  it('adds a name typed in the form, or a profile link', async () => {
    expect(
      await redirectOf('/user/anilist/Alice/together/Bob?add=https://anilist.co/user/Carol/')
    ).toBe('/user/anilist/Alice/together/Bob/Carol');
  });

  it('keeps someone already in the group once', async () => {
    expect(await redirectOf('/user/anilist/Alice/together/Bob?add=BOB')).toBe(
      '/user/anilist/Alice/together/Bob'
    );
  });

  it('stays on the form when the text cannot be a name, or the group is full', async () => {
    expect(await load(event('/user/anilist/Alice/together/Bob?add=two%20words'))).toEqual({
      host: { domain: 'anilist', name: 'Alice' },
      others: [{ domain: 'anilist', name: 'Bob' }],
      formError: 'invalid',
      typed: 'two words',
    });
    const full = '/user/anilist/Alice/together/B1/B2/B3/B4/B5';
    expect(await load(event(`${full}?add=Carol`))).toMatchObject({ formError: 'full' });
  });

  it('tidies a path with repeats or names that cannot be AniList’s', async () => {
    expect(await redirectOf('/user/anilist/Alice/together/Bob/bob/two%20words/Carol')).toBe(
      '/user/anilist/Alice/together/Bob/Carol'
    );
  });

  it('keeps a name typed on an untidy path, to add it once there', async () => {
    expect(await redirectOf('/user/anilist/Alice/together/Bob/bob?add=Carol')).toBe(
      '/user/anilist/Alice/together/Bob?add=Carol'
    );
  });
});

describe('a group with people on MyAnimeList', () => {
  it('adds someone from a MyAnimeList link, naming their service in the path', async () => {
    expect(
      await redirectOf('/user/anilist/Alice/together/Bob?add=myanimelist.net/profile/Mika')
    ).toBe('/user/anilist/Alice/together/Bob/myanimelist:Mika');
    expect(await redirectOf('/user/myanimelist/Mika/together?add=Sora')).toBe(
      '/user/myanimelist/Mika/together/Sora'
    );
  });

  it("adds a viewer with their account on the host's service, or else their other", async () => {
    expect(await redirectOf('/user/myanimelist/Mika/together', 'Alice', { mal: 'Sora' })).toBe(
      '/user/myanimelist/Mika/together/Sora'
    );
    expect(await redirectOf('/user/myanimelist/Mika/together', 'Alice')).toBe(
      '/user/myanimelist/Mika/together/anilist:Alice'
    );
  });

  it('tidies a path that names the service of someone on the host’s', async () => {
    expect(
      await redirectOf('/user/anilist/Alice/together/anilist:Bob/myanimelist:Bob/kitsu:Dana')
    ).toBe('/user/anilist/Alice/together/Bob/myanimelist:Bob');
  });

  it("leaves MyAnimeList's people out while it isn't set up", async () => {
    const off = { malEnabled: false };
    await expect(load(event('/user/myanimelist/Mika/together', null, off))).rejects.toMatchObject({
      status: 404,
    });
    expect(await redirectOf('/user/anilist/Alice/together/Bob/myanimelist:Mika', null, off)).toBe(
      '/user/anilist/Alice/together/Bob'
    );
  });
});

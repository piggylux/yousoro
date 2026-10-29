import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { load } from './+page.js';

type Event = Parameters<typeof load>[0];

function event(path: string, viewer: string | null = null) {
  const url = new URL(path, 'https://yousoro.test');
  const [, , domain, username, , ...others] = url.pathname.split('/');
  return {
    params: { domain, username, others: others.map(decodeURIComponent).join('/') },
    url,
    parent: async () => ({ user: viewer ? { id: 1, name: viewer } : null }),
  } as unknown as Event;
}

async function redirectOf(path: string, viewer: string | null = null) {
  try {
    await load(event(path, viewer));
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
      host: 'Alice',
      others: ['Bob'],
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

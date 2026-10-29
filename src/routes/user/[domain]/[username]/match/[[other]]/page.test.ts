import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { load } from './+page.js';

type Event = Parameters<typeof load>[0];

function event(path: string, viewer: string | null = null) {
  const url = new URL(path, 'https://yousoro.test');
  const [, , domain, username, , other] = url.pathname.split('/');
  return {
    params: { domain, username, other },
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
      name: 'Alice',
      other: null,
      invalidName: 'two words',
      same: false,
    });
  });

  it('never redirects a match that names both people', async () => {
    expect(await load(event('/user/anilist/Alice/match/Carol', 'Bob'))).toEqual({
      name: 'Alice',
      other: 'Carol',
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
      name: 'Alice',
      other: null,
      invalidName: null,
      same: true,
    });
  });
});

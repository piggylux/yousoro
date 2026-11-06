import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { POST } from './+server';

const aniList = { token: 'a.b.c', user: { id: 1, name: 'Viewer', avatarUrl: null } };
const mal = {
  token: 'mal',
  refreshToken: 'refresh',
  expiresAt: Infinity,
  user: { id: 2, name: 'ViewerMal', avatarUrl: null },
};

async function signOut(fields: Record<string, string>, locals: Partial<App.Locals> = {}) {
  const deleted: string[] = [];
  const cookies = { delete: (name: string) => void deleted.push(name) } as unknown as Cookies;
  const request = new Request('http://localhost/auth/logout', {
    method: 'POST',
    body: new URLSearchParams({ redirectTo: '/home', ...fields }),
  });
  let location: string | undefined;
  try {
    await POST({
      request,
      cookies,
      locals: { session: null, malSession: null, ...locals },
    } as unknown as Parameters<typeof POST>[0]);
  } catch (err) {
    expect(err).toMatchObject({ status: 303 });
    location = (err as { location: string }).location;
  }
  return { deleted, location };
}

describe('signing out', () => {
  it('signs out of every service from the header', async () => {
    expect(await signOut({})).toEqual({ deleted: ['session', 'session_mal'], location: '/home' });
  });

  it.each([
    ['anilist', ['session']],
    ['myanimelist', ['session_mal']],
  ])('signs out of %s alone from the account settings', async (service, cookies) => {
    expect((await signOut({ service })).deleted).toEqual(cookies);
  });

  it("comes back to the page it was on, such as someone else's list", async () => {
    const { location } = await signOut(
      { redirectTo: '/user/anilist/Someone?view=calendar' },
      { session: aniList, malSession: mal }
    );
    expect(location).toBe('/user/anilist/Someone?view=calendar');
  });

  it('goes home from the pages of an account it signed out of', async () => {
    const both = { session: aniList, malSession: mal };
    for (const redirectTo of ['/user/anilist/viewer', '/user/anilist/Viewer/friends']) {
      expect((await signOut({ redirectTo }, both)).location).toBe('/home');
    }
    // Signed out of AniList alone, MyAnimeList's list is still the viewer's
    expect(
      (await signOut({ service: 'anilist', redirectTo: '/user/anilist/Viewer' }, both)).location
    ).toBe('/home');
    expect(
      (await signOut({ service: 'anilist', redirectTo: '/user/myanimelist/ViewerMal' }, both))
        .location
    ).toBe('/user/myanimelist/ViewerMal');
    // The same name on the other service is someone else's
    expect(
      (await signOut({ service: 'myanimelist', redirectTo: '/user/anilist/ViewerMal' }, both))
        .location
    ).toBe('/user/anilist/ViewerMal');
  });
});

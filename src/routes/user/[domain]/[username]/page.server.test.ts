import { isRedirect, type ActionFailure, type Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveEntry as saveAniListEntry } from '#lib/server/anilist-client.js';
import { copyToLinkedAccount } from '#lib/server/linked-save.js';
import { MalTokenError, saveEntry } from '#lib/server/myanimelist-client.js';
import { MyAnimeListApi } from '#lib/server/myanimelist.js';
import type { MalSession, Session } from '#lib/server/session.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { actions, load } from './+page.server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  saveEntry: vi.fn(),
}));
vi.mock('#lib/server/myanimelist.js', () => ({ MyAnimeListApi: vi.fn() }));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  saveEntry: vi.fn(),
}));
vi.mock('#lib/server/linked-save.js', () => ({ copyToLinkedAccount: vi.fn(async () => null) }));

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const aniListSession: Session = { token: 'anilist.token.jwt', user: { ...user, id: 99 } };

function malSession(expiresAt = Date.now() + 3_600_000): MalSession {
  return { token: 'mal-token', refreshToken: 'refresh', expiresAt, user };
}

function event(
  malSignIn: MalSession | null,
  fields: Record<string, string> = {},
  aniListSignIn: Session | null = null
) {
  const deleted: string[] = [];
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const request = {
    params: { domain: 'myanimelist', username: 'Fixture' },
    locals: { session: aniListSignIn, malSession: malSignIn, preferences: DEFAULT_PREFERENCES },
    cookies: {
      get: () => undefined,
      set: vi.fn(),
      delete: (name: string) => void deleted.push(name),
    } as unknown as Cookies,
    request: new Request('http://localhost/user/myanimelist/Fixture?/updateEntry', {
      method: 'POST',
      body: form,
    }),
    getClientAddress: () => '127.0.0.1',
    isDataRequest: false,
    url: new URL('http://localhost/user/myanimelist/Fixture'),
  };
  return { request, deleted };
}

const update = (request: ReturnType<typeof event>['request']) =>
  actions.updateEntry!(
    request as unknown as Parameters<NonNullable<typeof actions.updateEntry>>[0]
  );

beforeEach(() => {
  vi.clearAllMocks();
  // MyAnimeList refuses to renew the sign-in
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
  );
  vi.mocked(MyAnimeListApi).mockImplementation(function (signedIn) {
    return {
      getUserAnimeList: vi.fn(async () => ({
        userId: signedIn?.owner.id ?? null,
        username: 'Fixture',
        avatarUrl: null,
        scoreFormat: 'POINT_10' as const,
        animeList: [],
        unmatched: [],
      })),
    } as unknown as MyAnimeListApi;
  });
});

describe('saving to a MyAnimeList list', () => {
  it("saves with the anime's MyAnimeList id and the user's token", async () => {
    const saved = { progress: 3, score: 0, status: 'CURRENT', startedAt: null, completedAt: null };
    vi.mocked(saveEntry).mockResolvedValue(saved);
    const { request } = event(malSession(), {
      mediaId: '7',
      malId: '52991',
      progress: '3',
      episodes: '12',
    });

    expect(await update(request)).toEqual({ mediaId: 7, ...saved });
    expect(saveEntry).toHaveBeenCalledWith('mal-token', 52991, { progress: 3 }, { episodes: 12 });
  });

  it('asks to sign in with MyAnimeList, even when signed in with AniList', async () => {
    const fields = { mediaId: '7', malId: '52991', progress: '3' };
    const { request } = event(null, fields, aniListSession);

    const result = (await update(request)) as ActionFailure<{ message: string }>;

    expect(result.status).toBe(401);
    expect(result.data.message).toBe('Sign in with MyAnimeList to update your list');
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it("signs out of MyAnimeList only, once its sign-in can't be renewed", async () => {
    vi.mocked(saveEntry).mockRejectedValue(new MalTokenError('expired'));
    const { request, deleted } = event(malSession(), { mediaId: '7', malId: '1', progress: '3' });

    const result = (await update(request)) as ActionFailure<{ message: string }>;

    expect(result.status).toBe(401);
    expect(result.data.message).toBe('Your MyAnimeList sign-in expired, please sign in again');
    expect(deleted).toEqual(['session_mal']);
  });
});

describe('reading your own MyAnimeList list', () => {
  it("falls back to the public list once the sign-in can't be renewed", async () => {
    const { request, deleted } = event(malSession(Date.now() - 1));

    const page = await load(request as unknown as Parameters<typeof load>[0]);

    expect(deleted).toEqual(['session_mal']);
    expect(page).toMatchObject({ domain: 'myanimelist', canEdit: false });
    expect(MyAnimeListApi).toHaveBeenCalledTimes(1);
    expect(MyAnimeListApi).toHaveBeenCalledWith();
  });

  it('reads it with the token and lets its owner edit it', async () => {
    const { request } = event(malSession());

    const page = await load(request as unknown as Parameters<typeof load>[0]);

    expect(page).toMatchObject({ canEdit: true, username: 'Fixture' });
    expect(MyAnimeListApi).toHaveBeenCalledWith({ token: 'mal-token', owner: user });
  });
});

describe('signed in to both services', () => {
  const aniList: Session = {
    token: 'anilist-token',
    user: { id: 99, name: 'AniFixture', avatarUrl: null },
  };

  function both(
    domain: 'anilist' | 'myanimelist',
    username: string,
    fields: Record<string, string> = {},
    search = ''
  ) {
    const { request, deleted } = event(malSession(), fields, aniList);
    request.params = { domain, username };
    request.url = new URL(`http://localhost/user/${domain}/${username}${search}`);
    return { request, deleted };
  }

  async function loadError(request: ReturnType<typeof event>['request']) {
    try {
      await load(request as unknown as Parameters<typeof load>[0]);
    } catch (err) {
      return err;
    }
    return null;
  }

  it("shows your other account's list on your main list, keeping the view", async () => {
    const err = await loadError(both('myanimelist', 'fixture', {}, '?view=calendar').request);

    expect(isRedirect(err) && err).toMatchObject({
      status: 303,
      location: '/user/anilist/AniFixture?view=calendar',
    });
  });

  it("doesn't move anyone else's list", async () => {
    expect(isRedirect(await loadError(both('myanimelist', 'Someone').request))).toBe(false);
  });

  it("saves a card only on the other service's list there, in that service's format", async () => {
    const saved = { progress: 4, score: 8, status: 'CURRENT', startedAt: null, completedAt: null };
    vi.mocked(saveEntry).mockResolvedValue(saved);
    const { request } = both('anilist', 'AniFixture', {
      mediaId: '7',
      malId: '52991',
      list: 'myanimelist',
      progress: '4',
      score: '8',
      scoreFormat: 'POINT_100',
      episodes: '12',
    });

    expect(await update(request)).toEqual({ mediaId: 7, ...saved });
    // MyAnimeList scores are out of 10, whatever format the form says
    expect(saveEntry).toHaveBeenCalledWith(
      'mal-token',
      52991,
      { progress: 4, score: 8 },
      { episodes: 12 }
    );
    expect(saveAniListEntry).not.toHaveBeenCalled();
    expect(copyToLinkedAccount).toHaveBeenCalledWith(
      request,
      'myanimelist',
      expect.objectContaining({ malId: 52991 }),
      saved
    );
  });

  it("turns away a save to the other service from a list that isn't combined", async () => {
    const { request } = event(malSession(), {
      mediaId: '7',
      malId: '52991',
      list: 'anilist',
      progress: '4',
    });

    const result = (await update(request)) as ActionFailure<{ message: string }>;

    expect(result.status).toBe(400);
    expect(saveAniListEntry).not.toHaveBeenCalled();
  });

  it("doesn't try to copy an anime MyAnimeList doesn't have", async () => {
    const saved = { progress: 2, score: 0, status: 'CURRENT', startedAt: null, completedAt: null };
    vi.mocked(saveAniListEntry).mockResolvedValue(saved);
    const { request } = both('myanimelist', 'Fixture', {
      mediaId: '7',
      list: 'anilist',
      progress: '2',
    });
    request.locals.preferences = { ...DEFAULT_PREFERENCES, mainList: 'myanimelist' };

    expect(await update(request)).toEqual({ mediaId: 7, ...saved });
    expect(saveAniListEntry).toHaveBeenCalledWith('anilist-token', 7, { progress: 2 });
    expect(copyToLinkedAccount).not.toHaveBeenCalled();
  });
});

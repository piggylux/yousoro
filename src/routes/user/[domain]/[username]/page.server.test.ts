import type { ActionFailure, Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const user = { id: 12, name: 'Fixture', avatarUrl: null };
const aniListSession: Session = { token: 'anilist.token.jwt', user: { ...user, id: 99 } };

function malSession(expiresAt = Date.now() + 3_600_000): MalSession {
  return { token: 'mal-token', refreshToken: 'refresh', expiresAt, user };
}

function event(malSignIn: MalSession | null, fields: Record<string, string> = {}) {
  const deleted: string[] = [];
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const request = {
    params: { domain: 'myanimelist', username: 'Fixture' },
    locals: { session: aniListSession, malSession: malSignIn, preferences: DEFAULT_PREFERENCES },
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
    vi.mocked(saveEntry).mockResolvedValue({ progress: 3, score: 0, status: 'CURRENT' });
    const { request } = event(malSession(), { mediaId: '7', malId: '52991', progress: '3' });

    expect(await update(request)).toEqual({ mediaId: 7, progress: 3, score: 0, status: 'CURRENT' });
    expect(saveEntry).toHaveBeenCalledWith('mal-token', 52991, { progress: 3 });
  });

  it('asks to sign in with MyAnimeList, even when signed in with AniList', async () => {
    const { request } = event(null, { mediaId: '7', malId: '52991', progress: '3' });

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

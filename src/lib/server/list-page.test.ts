import type { Cookies } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MalSession } from '#lib/server/session.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

vi.mock('$app/env/private', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MAL_CLIENT_ID: 'client-id',
  MAL_CLIENT_SECRET: 'secret',
}));

let loadAnimePage: (typeof import('./list-page.js'))['loadAnimePage'];
let visitor = 0;

const LIST = {
  data: {
    MediaListCollection: {
      user: { id: 1, name: 'Fixture', avatar: null, mediaListOptions: null },
      lists: [],
    },
  },
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ({ loadAnimePage } = await import('./list-page.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every request to AniList or MyAnimeList takes `ms`, or never answers */
function upstreamTakes(ms = Infinity) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          if (ms !== Infinity) setTimeout(() => resolve(Response.json(LIST)), ms);
        })
    )
  );
}

function load({
  domain = 'anilist',
  isDataRequest = false,
  malSession = null,
}: { domain?: string; isDataRequest?: boolean; malSession?: MalSession | null } = {}) {
  return loadAnimePage({
    params: { domain, username: 'Fixture' },
    locals: { session: null, malSession, preferences: DEFAULT_PREFERENCES },
    cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() } as unknown as Cookies,
    isDataRequest,
    getClientAddress: () => `list-page-${++visitor}`,
  });
}

/** Whether the load has settled once the clock has moved on by `ms` */
async function settledAfter(pending: Promise<unknown>, ms: number) {
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true)
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

function malSession(expiresAt: number): MalSession {
  return {
    token: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt,
    user: { id: 12, name: 'Fixture', avatarUrl: null },
  };
}

describe('a first load of a list', () => {
  it('shows the list when the service answers in time', async () => {
    upstreamTakes(1000);
    const pending = load();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ username: 'Fixture', watchingList: [] });
  });

  it('answers with a page saying the list is on its way when the service is slow', async () => {
    upstreamTakes();
    const failed = load().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await failed).toMatchObject({ status: 503, body: { loading: true } });
  });

  it("says the service isn't answering when the read fails, not that something broke", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const failed = await load().catch((err: unknown) => err);
    expect(failed).toMatchObject({
      status: 503,
      body: { message: "AniList isn't answering right now, please try again in a moment" },
    });
    expect(failed).not.toMatchObject({ body: { loading: true } });
  });

  it('waits for a MyAnimeList sign-in being renewed, as only its answer can save the new token', async () => {
    upstreamTakes();
    expect(
      await settledAfter(load({ domain: 'myanimelist', malSession: malSession(0) }), 5000)
    ).toBe(false);
  });

  it('waits for your own MyAnimeList list, whose read may renew a sign-in turned down early', async () => {
    upstreamTakes();
    const session = malSession(Date.now() + 60 * 60 * 1000);
    expect(await settledAfter(load({ domain: 'myanimelist', malSession: session }), 5000)).toBe(
      false
    );
  });

  it("doesn't wait on someone else's MyAnimeList list, read without your sign-in", async () => {
    upstreamTakes();
    const session = { ...malSession(0), user: { id: 13, name: 'Viewer', avatarUrl: null } };
    const failed = load({ domain: 'myanimelist', malSession: session }).catch(
      (err: unknown) => err
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(await failed).toMatchObject({ status: 503, body: { loading: true } });
  });
});

describe('a list read from the browser', () => {
  it('waits for a slow service rather than answering without the list', async () => {
    upstreamTakes(5000);
    const pending = load({ isDataRequest: true });
    expect(await settledAfter(pending, 4000)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ username: 'Fixture', watchingList: [] });
  });
});

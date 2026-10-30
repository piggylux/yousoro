import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyEntry,
  getWatchingEntries,
  MalForbiddenError,
  MalNotFoundError,
  MalRateLimitError,
  MalTokenError,
  saveEntry,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import { pauseMal, takeMalRequest } from '#lib/server/rate-limit.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id' }));
// Each test reads through a cache of its own
const cacheNamespace = vi.hoisted(() => ({ value: 0 }));
vi.mock('#lib/server/rate-limit.js', () => ({
  fingerprint: (value: string) => `${cacheNamespace.value}:${value}`,
  takeMalRequest: vi.fn(),
  pauseMal: vi.fn(),
}));

const API = 'https://api.myanimelist.net/v2';

function entry(id: number, status: string, isRewatching = false): MalEntry {
  return {
    node: { id, title: `Anime ${id}` },
    list_status: {
      status: status as MalEntry['list_status']['status'],
      score: 0,
      num_episodes_watched: 1,
      is_rewatching: isRewatching,
      updated_at: '2026-10-30T10:00:00+00:00',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cacheNamespace.value++;
  vi.mocked(takeMalRequest).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.stubGlobal('fetch', vi.fn());
});

describe('getWatchingEntries', () => {
  it('reads a public list with the client ID, rewatches from the completed list included', async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('status=watching')
        ? Response.json({ data: [entry(1, 'watching')] })
        : Response.json({ data: [entry(2, 'completed', true), entry(3, 'completed')] })
    );

    const entries = await getWatchingEntries('Fixture');

    expect(entries.map((e) => e.node.id)).toEqual([1, 2]);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(`${API}/users/Fixture/animelist?`);
    expect(init?.headers).toMatchObject({ 'X-MAL-CLIENT-ID': 'client-id' });
  });

  it("reads the signed-in user's own list as @me with their token", async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ data: [] }));

    await getWatchingEntries('Fixture', 'token');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(`${API}/users/@me/animelist?`);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
    expect(init?.headers).not.toHaveProperty('X-MAL-CLIENT-ID');
  });

  it('follows the next pages, but never off the API', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const link = String(url);
      if (link.includes('status=completed')) return Response.json({ data: [] });
      if (link === `${API}/page-2`) {
        return Response.json({
          data: [entry(2, 'watching')],
          paging: { next: 'https://evil.example/page-3' },
        });
      }
      return Response.json({ data: [entry(1, 'watching')], paging: { next: `${API}/page-2` } });
    });

    await expect(getWatchingEntries('Fixture')).rejects.toThrow('Not a MyAnimeList API URL');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).not.toContain(
      'https://evil.example/page-3'
    );
  });

  it.each([
    [404, MalNotFoundError],
    [403, MalForbiddenError],
  ])('turns a %i into its own error', async (status, type) => {
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status }));
    await expect(getWatchingEntries('Fixture')).rejects.toBeInstanceOf(type);
  });

  it('takes a refusal of a user’s own request as MyAnimeList asking to slow down', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 403 }));
    await expect(getWatchingEntries('Fixture', 'token')).rejects.toBeInstanceOf(MalRateLimitError);
    expect(pauseMal).toHaveBeenCalledWith(60);
  });

  it('reads a public list once for everyone, for 30 seconds', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ data: [] }));

    await Promise.all([getWatchingEntries('Fixture'), getWatchingEntries('Fixture')]);
    await getWatchingEntries('Fixture');
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    await getWatchingEntries('Fixture');
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });

  it('never keeps a user’s own list, only shares a read already under way', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ data: [] }));

    await Promise.all([
      getWatchingEntries('Fixture', 'token'),
      getWatchingEntries('Fixture', 'token'),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await getWatchingEntries('Fixture', 'token');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('pauses MyAnimeList when it says to slow down', async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } })
    );
    await expect(getWatchingEntries('Fixture')).rejects.toBeInstanceOf(MalRateLimitError);
    expect(pauseMal).toHaveBeenCalledWith(30);
  });

  it('stays within its own budget', async () => {
    vi.mocked(takeMalRequest).mockResolvedValue({ allowed: false, retryAfter: 12 });
    await expect(getWatchingEntries('Fixture')).rejects.toMatchObject({ retryAfter: 12 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a rejected token, so the caller can renew it', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 401 }));
    await expect(getWatchingEntries('Fixture', 'token')).rejects.toBeInstanceOf(MalTokenError);
  });
});

describe('saveEntry', () => {
  // Answers the anime's details with `details`, and the update with what it saved
  function answer(details: object) {
    vi.mocked(fetch).mockImplementation(async (_, init) => {
      if (init?.method !== 'PATCH') return Response.json(details);
      const body = new URLSearchParams(String(init.body));
      return Response.json({
        status: body.get('status') ?? 'watching',
        score: Number(body.get('score') ?? 0),
        num_episodes_watched: Number(body.get('num_watched_episodes') ?? 0),
        is_rewatching: body.get('is_rewatching') === 'true',
        updated_at: '2026-10-30T10:00:00+00:00',
      });
    });
  }

  function sentBody() {
    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
    return Object.fromEntries(new URLSearchParams(String(patch?.[1]?.body)));
  }

  it('saves the episode count alone while episodes remain', async () => {
    answer({ num_episodes: 12, my_list_status: { status: 'watching', is_rewatching: false } });

    const saved = await saveEntry('token', 52991, { progress: 3 });

    expect(sentBody()).toEqual({ num_watched_episodes: '3' });
    expect(saved).toEqual({
      progress: 3,
      score: 0,
      status: 'CURRENT',
      startedAt: null,
      completedAt: null,
    });
    const [url] = vi.mocked(fetch).mock.calls[1];
    expect(String(url)).toBe(`${API}/anime/52991/my_list_status`);
  });

  it('saves in one request when the page says the episode doesn’t finish the anime', async () => {
    answer({ num_episodes: 12, my_list_status: { status: 'watching', is_rewatching: false } });

    await saveEntry('token', 1, { progress: 3 }, { episodes: 12 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ num_watched_episodes: '3' });
  });

  it('reads the entry when the page says the episode may finish it', async () => {
    answer({ num_episodes: 12, my_list_status: { status: 'watching', is_rewatching: false } });

    await saveEntry('token', 1, { progress: 12 }, { episodes: 12 });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sentBody()).toMatchObject({ status: 'completed' });
  });

  it('completes the anime on its last episode, as AniList does', async () => {
    answer({ num_episodes: 12, my_list_status: { status: 'watching', is_rewatching: false } });

    const saved = await saveEntry('token', 1, { progress: 12, score: 9 });

    expect(sentBody()).toEqual({ num_watched_episodes: '12', status: 'completed', score: '9' });
    expect(saved.status).toBe('COMPLETED');
  });

  it('ends a rewatch on its last episode and counts it', async () => {
    answer({
      num_episodes: 12,
      my_list_status: { status: 'completed', is_rewatching: true, num_times_rewatched: 1 },
    });

    await saveEntry('token', 1, { progress: 12 });

    expect(sentBody()).toEqual({
      num_watched_episodes: '12',
      status: 'completed',
      is_rewatching: 'false',
      num_times_rewatched: '2',
    });
  });

  it('saves a score alone without reading the anime first', async () => {
    answer({});

    await saveEntry('token', 1, { score: 8 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ score: '8' });
  });

  it('adds an anime that is not on the list yet as watching', async () => {
    answer({ num_episodes: 0 });

    await saveEntry('token', 1, { progress: 1 });

    expect(sentBody()).toEqual({ num_watched_episodes: '1', status: 'watching' });
  });

  it('reports a rewatch in AniList terms', async () => {
    answer({ num_episodes: 12, my_list_status: { status: 'completed', is_rewatching: true } });
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ num_episodes: 12, my_list_status: { is_rewatching: true } })
    );
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ ...entry(1, 'completed', true).list_status, num_episodes_watched: 4 })
    );

    expect(await saveEntry('token', 1, { progress: 4 })).toMatchObject({ status: 'REPEATING' });
  });
});

describe('copyEntry', () => {
  function patched() {
    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PATCH');
    return Object.fromEntries(new URLSearchParams(String(patch?.[1]?.body)));
  }

  beforeEach(() => {
    vi.mocked(fetch).mockImplementation(async (_, init) =>
      init?.method === 'PATCH'
        ? Response.json({})
        : Response.json({ my_list_status: { is_rewatching: true, num_times_rewatched: 2 } })
    );
  });

  it('sets the episode count and status AniList saved, in one request', async () => {
    await copyEntry('token', 1, { progress: 4, status: 'CURRENT' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(patched()).toEqual({
      num_watched_episodes: '4',
      status: 'watching',
      is_rewatching: 'false',
    });
  });

  it("sets the dates it's given, and leaves those it isn't", async () => {
    await copyEntry('token', 1, {
      progress: 4,
      status: 'CURRENT',
      startedAt: '2026-10-01',
      completedAt: null,
    });

    expect(patched()).toMatchObject({ start_date: '2026-10-01' });
    expect(patched()).not.toHaveProperty('finish_date');
  });

  it('keeps a rewatch as a completed anime watched again, with its score', async () => {
    await copyEntry('token', 1, { progress: 2, status: 'REPEATING', score: 8 });

    expect(patched()).toEqual({
      num_watched_episodes: '2',
      status: 'completed',
      is_rewatching: 'true',
      score: '8',
    });
  });

  it('makes a single request, within its share of the budget, when told not to count', async () => {
    await copyEntry(
      'token',
      1,
      { progress: 12, status: 'COMPLETED' },
      { countRewatch: false, priority: 'optional' }
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(patched()).not.toHaveProperty('num_times_rewatched');
    expect(takeMalRequest).toHaveBeenCalledWith('optional');
  });

  it('counts a rewatch AniList finished as one more time watched', async () => {
    await copyEntry('token', 1, { progress: 12, status: 'COMPLETED' });

    expect(patched()).toMatchObject({
      status: 'completed',
      is_rewatching: 'false',
      num_times_rewatched: '3',
    });
  });
});

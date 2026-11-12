import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyEntry,
  deleteEntry,
  getListEntry,
  getListedIds,
  getListStatuses,
  getPlanToWatchEntries,
  getSeasonTasteEntries,
  getWatchingEntries,
  MalForbiddenError,
  MalNotFoundError,
  MalRateLimitError,
  MalTokenError,
  moveToList,
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
  // Undoes Date.now spies, even those of a test that failed before undoing its own
  vi.restoreAllMocks();
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

  it('says what a finished entry held before, so the finish can be reverted', async () => {
    answer({
      num_episodes: 12,
      my_list_status: {
        status: 'completed',
        is_rewatching: true,
        num_times_rewatched: 1,
        start_date: '2025-01-02',
        finish_date: '2025-03-04',
      },
    });

    expect(await saveEntry('token', 1, { progress: 12 })).toMatchObject({
      status: 'COMPLETED',
      beforeFinish: {
        rewatched: 1,
        startedAt: '2025-01-02',
        completedAt: '2025-03-04',
        added: [],
      },
    });

    // An episode that doesn't finish it has nothing to put back
    answer({ num_episodes: 12, my_list_status: { status: 'watching', is_rewatching: false } });
    expect(await saveEntry('token', 1, { progress: 11 })).not.toHaveProperty('beforeFinish');
  });

  it('says which dates a finish set, so reverting clears those alone', async () => {
    vi.mocked(fetch).mockImplementation(async (_, init) =>
      init?.method === 'PATCH'
        ? Response.json({
            ...entry(1, 'completed').list_status,
            num_episodes_watched: 12,
            start_date: '2026-10-01',
            finish_date: '2026-11-11',
          })
        : Response.json({
            num_episodes: 12,
            my_list_status: { status: 'watching', is_rewatching: false, start_date: '2026-10-01' },
          })
    );

    expect((await saveEntry('token', 1, { progress: 12 })).beforeFinish).toEqual({
      rewatched: 0,
      startedAt: '2026-10-01',
      completedAt: null,
      added: ['completedAt'],
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

  it('puts back a rewatch count and clears the dates a reverted finish set', async () => {
    await copyEntry(
      'token',
      1,
      {
        progress: 11,
        status: 'REPEATING',
        rewatched: 1,
        startedAt: '2025-01-02',
        completedAt: null,
        clear: ['completedAt'],
      },
      { countRewatch: false }
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(patched()).toEqual({
      num_watched_episodes: '11',
      status: 'completed',
      is_rewatching: 'true',
      num_times_rewatched: '1',
      start_date: '2025-01-02',
      finish_date: '',
    });
  });

  it('takes back the rewatch a copied finish counted, only once it is no longer rewatched', async () => {
    vi.mocked(fetch).mockImplementation(async (_, init) =>
      init?.method === 'PATCH'
        ? Response.json({})
        : Response.json({ my_list_status: { is_rewatching: false, num_times_rewatched: 2 } })
    );
    const revert = { countRewatch: false, uncountRewatch: true };

    await copyEntry('token', 1, { progress: 11, status: 'REPEATING' }, revert);
    expect(patched()).toMatchObject({ is_rewatching: 'true', num_times_rewatched: '1' });

    // Still being watched again there: the copy of the finish didn't reach it, so there's no count
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(async (_, init) =>
      init?.method === 'PATCH'
        ? Response.json({})
        : Response.json({ my_list_status: { is_rewatching: true, num_times_rewatched: 2 } })
    );
    await copyEntry('token', 1, { progress: 11, status: 'REPEATING' }, revert);
    expect(patched()).not.toHaveProperty('num_times_rewatched');
  });
});

describe('getPlanToWatchEntries', () => {
  it('reads a public list in one request, with what its posters show, and keeps it five minutes', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ data: [entry(1, 'plan_to_watch')] })
    );
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await Promise.all([getPlanToWatchEntries('Planner'), getPlanToWatchEntries('PLANNER')]);
    vi.mocked(Date.now).mockReturnValue(now + 4 * 60 * 1000);
    expect(await getPlanToWatchEntries('planner')).toEqual([entry(1, 'plan_to_watch')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe('/v2/users/planner/animelist');
    expect(url.searchParams.get('status')).toBe('plan_to_watch');
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(url.searchParams.get('fields')?.split(',')).toEqual(
      expect.arrayContaining([
        'list_status',
        'num_episodes',
        'status',
        'mean',
        // The genre filter and the year each row shows
        'genres',
        'start_season',
      ])
    );

    vi.mocked(Date.now).mockReturnValue(now + 5 * 60 * 1000);
    await getPlanToWatchEntries('planner');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(takeMalRequest).toHaveBeenCalledWith('optional');
  });

  it("reads the owner's list with their token every time, and never keeps it", async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ data: [] }));
    await getPlanToWatchEntries('Owner', 'token');
    await getPlanToWatchEntries('Owner', 'token');
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toMatch(`${API}/users/@me/animelist?status=plan_to_watch`);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });

    // An anonymous read afterwards doesn't get the owner's view of the list
    await getPlanToWatchEntries('Owner');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('getListedIds', () => {
  it('reads the whole list by page, keeping the ids on each list other than Watching', async () => {
    const next = `${API}/users/@me/animelist?offset=1000`;
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          data: [
            entry(1, 'plan_to_watch'),
            entry(2, 'completed'),
            entry(3, 'on_hold'),
            entry(4, 'dropped'),
            // On the Watching list, which the page has already
            entry(5, 'watching'),
            entry(6, 'completed', true),
          ],
          paging: { next },
        })
      )
      .mockResolvedValueOnce(Response.json({ data: [entry(7, 'completed')] }));

    expect(await getListedIds('token')).toEqual({
      PLANNING: [1],
      COMPLETED: [2, 7],
      PAUSED: [3],
      DROPPED: [4],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.pathname).toBe('/v2/users/@me/animelist');
    expect(url.searchParams.get('fields')).toBe('list_status');
    expect(url.searchParams.get('limit')).toBe('1000');
    // Only for the search, so it gives way to lists and saves
    expect(takeMalRequest).toHaveBeenCalledWith('optional');
  });
});

describe('moveToList', () => {
  it('moves an anime to "Watching" in one request, leaving the rest of the entry alone', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...entry(1, 'watching').list_status, num_episodes_watched: 0, score: 0 })
    );

    expect(await moveToList('token', 52991, 'CURRENT')).toEqual({
      progress: 0,
      score: 0,
      status: 'CURRENT',
      startedAt: null,
      completedAt: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`${API}/anime/52991/my_list_status`);
    expect(init?.method).toBe('PATCH');
    expect(String(init?.body)).toBe('status=watching');
  });

  it('plans an anime as "Plan to Watch"', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...entry(1, 'plan_to_watch').list_status, num_episodes_watched: 0 })
    );

    expect(await moveToList('token', 52991, 'PLANNING')).toMatchObject({ status: 'PLANNING' });
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toBe('status=plan_to_watch');
  });
});

describe('reading and taking off one entry, for undoing an add', () => {
  it('reads what an entry holds, in AniList terms, and none for one not on the list', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          my_list_status: {
            status: 'plan_to_watch',
            is_rewatching: false,
            num_episodes_watched: 0,
            score: 0,
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ id: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    expect(await getListEntry('token', 1)).toEqual({
      status: 'PLANNING',
      progress: 0,
      score: 0,
      rewatched: 0,
      startedAt: null,
      completedAt: null,
    });
    expect(await getListEntry('token', 1)).toBeNull();
    expect(await getListEntry('token', 1)).toBeNull();
  });

  it('reads the dates too, so a revert can put them back', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        my_list_status: {
          status: 'completed',
          is_rewatching: true,
          num_episodes_watched: 4,
          score: 8,
          num_times_rewatched: 1,
          start_date: '2025-01-02',
          finish_date: '2025-03',
        },
      })
    );

    expect(await getListEntry('token', 1)).toEqual({
      status: 'REPEATING',
      progress: 4,
      score: 8,
      rewatched: 1,
      startedAt: '2025-01-02',
      completedAt: '2025-03',
    });
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain('start_date,finish_date}');
  });

  it('deletes an entry, which answers with nothing, and is done with one already off', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await deleteEntry('token', 52991);
    await deleteEntry('token', 52991);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`${API}/anime/52991/my_list_status`);
    expect(init?.method).toBe('DELETE');
  });
});

describe('getListStatuses', () => {
  it("says where each anime is on the owner's list, in AniList's terms, leaving out unknown ones", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const id = Number(/anime\/(\d+)/.exec(String(url))![1]);
      if (id === 3) return new Response(null, { status: 404 });
      return Response.json(
        id === 1
          ? { id, my_list_status: { status: 'plan_to_watch', is_rewatching: false } }
          : id === 2
            ? { id, my_list_status: { status: 'completed', is_rewatching: true } }
            : { id }
      );
    });

    const statuses = await getListStatuses('token', [1, 2, 3, 4]);

    expect([...statuses]).toEqual([
      [1, 'PLANNING'],
      [2, 'REPEATING'],
      [4, null],
    ]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      `${API}/anime/1?fields=my_list_status{status,is_rewatching}`
    );
    // A user's own list status is never kept for anyone else
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer token',
    });
  });

  it('fails as a whole when the token is rejected', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    await expect(getListStatuses('token', [1])).rejects.toBeInstanceOf(MalTokenError);
  });
});

describe('getSeasonTasteEntries', () => {
  const tasted = (id: number, status: string, score: number) => ({
    ...entry(id, status),
    node: {
      id,
      title: `Anime ${id}`,
      genres: [{ id: 1, name: 'Drama' }],
      studios: [{ id: 2, name: 'Madhouse' }],
    },
    list_status: { ...entry(id, status).list_status, score },
  });

  it('reads the whole list with genres and studios, one request per 1,000 anime', async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes('offset=1000')
        ? Response.json({ data: [tasted(2, 'dropped', 3)] })
        : Response.json({
            data: [tasted(1, 'completed', 8)],
            paging: { next: `${API}/users/Taster/animelist?offset=1000` },
          })
    );

    const entries = await getSeasonTasteEntries('Taster');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(takeMalRequest).toHaveBeenCalledWith('optional');
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(
      `${API}/users/taster/animelist?limit=1000&fields=list_status,genres,studios&nsfw=true`
    );
    expect(entries).toEqual([
      {
        id: 1,
        status: 'COMPLETED',
        progress: 1,
        score100: 80,
        genres: ['Drama'],
        studios: ['Madhouse'],
      },
      {
        id: 2,
        status: 'DROPPED',
        progress: 1,
        score100: 30,
        genres: ['Drama'],
        studios: ['Madhouse'],
      },
    ]);
  });

  it('keeps an anonymous read for ten minutes, but never the owner’s own', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ data: [] }));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await getSeasonTasteEntries('Kept');
    vi.spyOn(Date, 'now').mockReturnValue(now + 9 * 60 * 1000);
    await getSeasonTasteEntries('KEPT');
    expect(fetch).toHaveBeenCalledTimes(1);

    await getSeasonTasteEntries('Kept', 'token');
    await getSeasonTasteEntries('Kept', 'token');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('/users/@me/animelist');
  });
});

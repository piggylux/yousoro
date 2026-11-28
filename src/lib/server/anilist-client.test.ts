import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  AniListTokenError,
  deleteEntry,
  fromFuzzyDate,
  getAllListEntries,
  getAnimeYear,
  getFollowing,
  getFriendActivity,
  getLatestAirings,
  getListEntry,
  getListStatus,
  getNotifications,
  getPlanningEntries,
  getSeasonTaste,
  getSequels,
  getSeries,
  getTasteProfile,
  getUnreadNotificationCount,
  getViewer,
  getWatchingEntries,
  saveEntries,
  saveEntry,
} from '#lib/server/anilist-client.js';
import { pauseAniList, takeAniListRequest } from '#lib/server/rate-limit.js';

vi.mock('#lib/server/rate-limit.js', () => ({
  fingerprint: (value: string) => value,
  takeAniListRequest: vi.fn(),
  pauseAniList: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(takeAniListRequest).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        data: { Viewer: { id: 1, name: 'Fixture', avatar: null } },
      })
    )
  );
});

describe('AniList request protection', () => {
  it('skips user resolution for a matching known profile but never for a different username', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const { query, variables } = JSON.parse(init!.body as string);
      if (query.includes('User(name:'))
        return Response.json({ data: { User: { id: 92, name: 'Other', avatar: null } } });
      expect([91, 92]).toContain(variables.id);
      return Response.json({
        data: { Page: { pageInfo: { total: 0, hasNextPage: false }, following: [] } },
      });
    });
    const known = { id: 91, name: 'Known', avatarUrl: null };
    expect((await getFollowing('KNOWN', 'test-known', known)).user).toEqual(known);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await getFollowing('Other', 'test-known', known)).user.id).toBe(92);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('expires anonymous cache entries and never caches authenticated results', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const { query } = JSON.parse(init!.body as string);
      return Response.json({
        data: query.includes('User(name:')
          ? { User: { id: 1, name: 'Fixture', avatar: null } }
          : { Page: { pageInfo: { total: 0, hasNextPage: false }, following: [] } },
      });
    });
    await getFollowing('Fixture');
    await getFollowing('Fixture');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(takeAniListRequest).toHaveBeenCalledTimes(2);
    await getFollowing('Fixture', 'private-token');
    expect(fetch).toHaveBeenCalledTimes(4);
    await getFollowing('Fixture');
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.spyOn(Date, 'now').mockReturnValue(now + 300_000);
    await getFollowing('Fixture');
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it('coalesces concurrent reads for one token without reusing them after completion or across tokens', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ data: { Viewer: { id: 1, name: 'Fixture', avatar: null } } })
    );
    await Promise.all([getViewer('same-token'), getViewer('same-token')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await getViewer('same-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    await Promise.all([getViewer('token-a'), getViewer('token-b')]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('does not let a post-save reload join an older in-flight read', async () => {
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockImplementationOnce(async () =>
        Response.json({
          data: { SaveMediaListEntry: { progress: 4, score: 0, status: 'CURRENT' } },
        })
      )
      .mockImplementationOnce(async () =>
        Response.json({ data: { Viewer: { id: 1, name: 'Fresh', avatar: null } } })
      );
    const olderRead = getViewer('read-save-token');
    await Promise.resolve();
    await saveEntry('read-save-token', 1, { progress: 4 });
    expect((await getViewer('read-save-token')).name).toBe('Fresh');
    resolveOld(Response.json({ data: { Viewer: { id: 1, name: 'Old', avatar: null } } }));
    await olderRead;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('reuses public recent-airing results across progress refreshes with changing timestamps and media subsets', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ data: { Page: { airingSchedules: [{ mediaId: 9001, airingAt: 1200 }] } } })
    );
    expect(await getLatestAirings([9001, 9002], 1000)).toEqual(new Map([[9001, 1200]]));
    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    expect(await getLatestAirings([9001], 1010)).toEqual(new Map([[9001, 1200]]));
    expect(await getLatestAirings([9002], 1010)).toEqual(new Map());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await getLatestAirings([9001], 1200)).toEqual(new Map());
    vi.spyOn(Date, 'now').mockReturnValue(now + 30_000);
    await getLatestAirings([9001], 1030);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('sends updates using the bearer token without accepting a target user ID', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { SaveMediaListEntry: { progress: 3, score: 8, status: 'CURRENT' } } })
    );
    expect(await saveEntry('owner-token', 123, { progress: 3 })).toMatchObject({
      progress: 3,
      score: 8,
      status: 'CURRENT',
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer owner-token' });
    const body = JSON.parse(init!.body as string);
    expect(body.variables).toEqual({ mediaId: 123, progress: 3 });
    expect(body.query).not.toContain('userId');
    expect(body.query).toContain('progress score status');
  });

  it('reads a whole list 500 entries at a time, each anime once, hidden ones included', async () => {
    const entry = (id: number) => ({
      status: 'COMPLETED',
      progress: 1,
      score: 0,
      updatedAt: 1,
      media: { id },
    });
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        Response.json({
          data: {
            MediaListCollection: {
              hasNextChunk: true,
              lists: [
                { isCustomList: false, entries: [entry(1)] },
                // A custom list repeats entry 1, and holds entry 3, hidden from the status lists
                { isCustomList: true, entries: [entry(1), entry(3)] },
              ],
            },
          },
        })
      )
      .mockImplementationOnce(async () =>
        Response.json({
          data: {
            MediaListCollection: {
              hasNextChunk: false,
              lists: [{ isCustomList: false, entries: [entry(2)] }],
            },
          },
        })
      );

    const entries = await getAllListEntries(40, 'owner-token');

    expect(entries.map((listEntry) => listEntry.media.id)).toEqual([1, 3, 2]);
    const chunks = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => JSON.parse(init!.body as string).variables);
    expect(chunks).toEqual([
      { userId: 40, chunk: 1 },
      { userId: 40, chunk: 2 },
    ]);
  });

  it('saves several entries in one request, within the budget it was given', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { save0: { id: 1 }, save1: { id: 2 } } })
    );

    await saveEntries(
      'owner-token',
      [
        { mediaId: 1, progress: 3, status: 'CURRENT', scoreRaw: 80 },
        { mediaId: 2, progress: 12, status: 'COMPLETED' },
      ],
      'optional'
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.query).toMatch(/save0: SaveMediaListEntry[\s\S]*save1: SaveMediaListEntry/);
    // A score left out stays as it is on AniList
    expect(body.variables).toEqual({
      mediaId0: 1,
      progress0: 3,
      status0: 'CURRENT',
      scoreRaw0: 80,
      mediaId1: 2,
      progress1: 12,
      status1: 'COMPLETED',
    });
  });

  it('writes dates in parts and reads them back as text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          SaveMediaListEntry: {
            progress: 12,
            score: 0,
            status: 'COMPLETED',
            startedAt: { year: 2026, month: 9, day: 1 },
            completedAt: { year: 2026, month: 10, day: null },
          },
        },
      })
    );

    const saved = await saveEntry('owner-token', 1, {
      progress: 12,
      startedAt: '2026-09-01',
      completedAt: '2026-10',
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.variables).toMatchObject({
      startedAt: { year: 2026, month: 9, day: 1 },
      completedAt: { year: 2026, month: 10, day: null },
    });
    expect(saved).toMatchObject({ startedAt: '2026-09-01', completedAt: '2026-10' });
  });

  it('clears only the dates it is told to, and sets the rewatch count, for reverting a finish', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          SaveMediaListEntry: {
            progress: 11,
            score: 0,
            status: 'REPEATING',
            startedAt: { year: 2026, month: 9, day: 1 },
            completedAt: null,
          },
        },
      })
    );

    await saveEntry('owner-token', 1, {
      progress: 11,
      status: 'REPEATING',
      repeat: 1,
      startedAt: '2026-09-01',
      completedAt: null,
      clear: ['completedAt'],
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.query).toContain('repeat: $repeat');
    expect(body.variables).toEqual({
      mediaId: 1,
      progress: 11,
      status: 'REPEATING',
      repeat: 1,
      startedAt: { year: 2026, month: 9, day: 1 },
      completedAt: { year: null, month: null, day: null },
    });
  });

  it.each([
    [{ year: 2026, month: 9, day: 1 }, '2026-09-01'],
    [{ year: 2026, month: 9, day: null }, '2026-09'],
    [{ year: 2026, month: null, day: null }, '2026'],
    [{ year: null, month: 9, day: 1 }, null],
    [null, null],
  ])('reads the date %o as %s', (date, text) => {
    expect(fromFuzzyDate(date)).toBe(text);
  });

  it('propagates AniList rejection of a forged or expired token on writes', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: null, errors: [{ message: 'Invalid token' }] }, { status: 401 })
    );
    await expect(saveEntry('forged.token.signature', 123, { progress: 3 })).rejects.toBeInstanceOf(
      AniListTokenError
    );
  });

  it('does not contact AniList when the instance budget is exhausted', async () => {
    vi.mocked(takeAniListRequest).mockResolvedValue({ allowed: false, retryAfter: 24 });
    await expect(getViewer('fixture')).rejects.toMatchObject({ retryAfter: 24 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sets a timeout and forbids redirects and response caching', async () => {
    await getViewer('fixture');
    expect(fetch).toHaveBeenCalledWith(
      'https://graphql.anilist.co',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });

  it.each([
    ['45', 45],
    ['invalid', 60],
    ['900', 900],
  ])('records a bounded cooldown for Retry-After=%s', async (header, seconds) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('', { status: 429, headers: { 'Retry-After': String(header) } })
    );
    await expect(getViewer('fixture')).rejects.toBeInstanceOf(AniListRateLimitError);
    expect(pauseAniList).toHaveBeenCalledWith(seconds);
  });
});

describe('series', () => {
  type Part = {
    title: string;
    native?: string;
    earlier?: [id: number, title: string, episodes: number | null][];
  };
  // Answers AniList's relation queries from a chain of parts, by id
  function serve(parts: Record<number, Part>) {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const { id } = JSON.parse(init!.body as string).variables;
      const { title, native = null, earlier = [] } = parts[id];
      return Response.json({
        data: {
          Media: {
            title: { romaji: title, native },
            relations: {
              edges: [
                ...earlier.map(([id, title, episodes]) => ({
                  relationType: 'PREQUEL',
                  node: { id, type: 'ANIME', format: 'TV', episodes, title: { romaji: title } },
                })),
                // Not a TV part of the series, so never counted
                {
                  relationType: 'PREQUEL',
                  node: {
                    id: 9,
                    type: 'ANIME',
                    format: 'MOVIE',
                    episodes: 1,
                    title: { romaji: title },
                  },
                },
                {
                  relationType: 'ADAPTATION',
                  node: {
                    id: 8,
                    type: 'MANGA',
                    format: 'MANGA',
                    episodes: null,
                    title: { romaji: title },
                  },
                },
              ],
            },
          },
        },
      });
    });
  }

  it("counts the earlier parts' episodes back to the first part, but not the original series", async () => {
    serve({
      104: {
        title: 'BLEACH: Sennen Kessen-hen - Kashin-tan',
        earlier: [[103, 'BLEACH: Sennen Kessen-hen - Soukoku-tan', 14]],
      },
      103: {
        title: 'BLEACH: Sennen Kessen-hen - Soukoku-tan',
        earlier: [[102, 'BLEACH: Sennen Kessen-hen - Ketsubetsu-tan', 13]],
      },
      102: {
        title: 'BLEACH: Sennen Kessen-hen - Ketsubetsu-tan',
        earlier: [[101, 'BLEACH: Sennen Kessen-hen', 13]],
      },
      101: { title: 'BLEACH: Sennen Kessen-hen', earlier: [[100, 'BLEACH', 366]] },
    });
    expect((await getSeries(104)).arc).toEqual({
      offset: 40,
      title: 'BLEACH: Sennen Kessen-hen',
      season: 4,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    // With the titles of the series' other TV entries, not its movies or manga
    expect((await getSeries(104)).related).toEqual(['BLEACH: Sennen Kessen-hen - Soukoku-tan']);
    // Kept for the next search
    expect((await getSeries(104)).arc).toEqual({
      offset: 40,
      title: 'BLEACH: Sennen Kessen-hen',
      season: 4,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("returns the anime's native title, which sukebei releases often go by", async () => {
    serve({ 601: { title: 'Show', native: '日本語タイトル' } });
    expect(await getSeries(601)).toMatchObject({ arc: null, native: '日本語タイトル' });
  });

  it("names the series with the words its parts' titles share", async () => {
    serve({
      712: {
        title: 'JoJo no Kimyou na Bouken: Steel Ball Run - 2nd & 3rd STAGE',
        earlier: [[711, 'JoJo no Kimyou na Bouken: Steel Ball Run - 1st STAGE', 1]],
      },
      711: { title: 'JoJo no Kimyou na Bouken: Steel Ball Run - 1st STAGE' },
    });
    expect((await getSeries(712)).arc).toEqual({
      offset: 1,
      title: 'JoJo no Kimyou na Bouken: Steel Ball Run',
      season: 2,
    });
  });

  it('leaves out the season words the parts share', async () => {
    serve({
      203: { title: 'SPY×FAMILY Season 3', earlier: [[202, 'SPY×FAMILY Season 2', 12]] },
      202: { title: 'SPY×FAMILY Season 2', earlier: [[201, 'SPY×FAMILY', 25]] },
      201: { title: 'SPY×FAMILY' },
    });
    expect((await getSeries(203)).arc).toEqual({ offset: 37, title: 'SPY×FAMILY', season: 3 });
  });

  it.each([
    ['no earlier part', { 301: { title: 'Dungeon Meshi' } }],
    [
      'an unrelated earlier part',
      { 311: { title: 'Nisemonogatari', earlier: [[310, 'Bakemonogatari', 15]] } },
    ],
    [
      'two earlier parts to choose from',
      {
        321: {
          title: 'Show 2nd Season',
          earlier: [
            [320, 'Show', 12],
            [319, 'Show Recap', 1],
          ],
        },
      },
    ],
    [
      'an earlier part of unknown length',
      { 331: { title: 'Show 2nd Season', earlier: [[330, 'Show', null]] } },
    ],
  ] as [string, Record<number, Part>][])('counts nothing for %s', async (_case, parts) => {
    serve(parts);
    expect((await getSeries(Math.max(...Object.keys(parts).map(Number)))).arc).toBeNull();
  });

  it('asks again within the hour about an earlier part of unknown length', async () => {
    serve({ 342: { title: 'Show 2nd Season', earlier: [[341, 'Show', null]] } });
    expect((await getSeries(342)).arc).toBeNull();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61 * 60 * 1000);
    serve({
      342: { title: 'Show 2nd Season', earlier: [[341, 'Show', 12]] },
      341: { title: 'Show' },
    });
    expect((await getSeries(342)).arc).toEqual({ offset: 12, title: 'Show', season: 2 });
  });

  it('counts nothing for now when AniList has no requests to spare, and asks again later', async () => {
    serve({
      402: { title: 'Show 2nd Season', earlier: [[401, 'Show', 12]] },
      401: { title: 'Show' },
    });
    vi.mocked(takeAniListRequest).mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
    await expect(getSeries(402)).rejects.toBeInstanceOf(AniListRateLimitError);
    expect((await getSeries(402)).arc).toEqual({ offset: 12, title: 'Show', season: 2 });
  });
});

describe('taste profiles', () => {
  const entry = (
    id: number,
    status: string,
    score: number,
    updatedAt = 0,
    airing = 'FINISHED'
  ) => ({
    status,
    score,
    updatedAt,
    media: {
      id,
      title: { romaji: `Anime ${id}` },
      coverImage: { large: `https://s4.anilist.co/${id}.jpg` },
      isAdult: false,
      meanScore: 70,
      status: airing,
    },
  });
  const collection = (name: string) =>
    Response.json({
      data: {
        MediaListCollection: {
          user: {
            id: 7,
            name,
            avatar: { large: null },
            mediaListOptions: { scoreFormat: 'POINT_10' },
          },
          lists: [
            {
              isCustomList: false,
              entries: [
                entry(1, 'COMPLETED', 9),
                entry(2, 'DROPPED', 0),
                entry(3, 'PLANNING', 0),
                // Not aired yet, so nobody can start it
                entry(5, 'PLANNING', 0, 0, 'NOT_YET_RELEASED'),
                // Listed twice, as after a double import: the later edit stands
                entry(4, 'CURRENT', 5, 10),
                entry(4, 'COMPLETED', 8, 20),
              ],
            },
            // Custom lists repeat entries from the status lists
            { isCustomList: true, entries: [entry(1, 'COMPLETED', 9)] },
          ],
        },
      },
    });

  it('reads a whole list anonymously, at the lowest priority, and trims it', async () => {
    vi.mocked(fetch).mockResolvedValue(collection('Taster'));
    const profile = await getTasteProfile('Taster');
    expect(profile).toEqual({
      id: 7,
      name: 'Taster',
      avatarUrl: null,
      scoreFormat: 'POINT_10',
      scored: [
        expect.objectContaining({ id: 1, score: 9, score100: 90 }),
        expect.objectContaining({ id: 4, score: 8, score100: 80 }),
      ],
      seen: [2],
      planned: [expect.objectContaining({ id: 3 })],
    });
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(init.headers).not.toHaveProperty('Authorization');
    const { query } = JSON.parse(init.body as string);
    expect(query).not.toContain('status_in');
    // AniList answers both with scores out of 100 when one query asks for both
    expect(query).not.toContain('POINT_100');
    expect(takeAniListRequest).toHaveBeenCalledWith('spare');
  });

  it('reads a list once for every spelling of the name, and for simultaneous comparisons', async () => {
    vi.mocked(fetch).mockImplementation(async () => collection('Shared'));
    await Promise.all([getTasteProfile('Shared'), getTasteProfile('SHARED')]);
    await getTasteProfile('shared');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).variables).toEqual({
      userName: 'shared',
    });
  });

  it('reads a list again once its profile is ten minutes old', async () => {
    vi.mocked(fetch).mockImplementation(async () => collection('Aging'));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await getTasteProfile('Aging');
    vi.spyOn(Date, 'now').mockReturnValue(now + 9 * 60 * 1000);
    await getTasteProfile('Aging');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
    await getTasteProfile('Aging');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never asks AniList about a name that cannot exist', async () => {
    await expect(getTasteProfile('../settings')).rejects.toBeInstanceOf(AniListNotFoundError);
    await expect(getTasteProfile('x'.repeat(40))).rejects.toBeInstanceOf(AniListNotFoundError);
    expect(fetch).not.toHaveBeenCalled();
    expect(takeAniListRequest).not.toHaveBeenCalled();
  });

  it('gives way when AniList has no spare requests, without keeping the failure', async () => {
    vi.mocked(fetch).mockImplementation(async () => collection('Patient'));
    vi.mocked(takeAniListRequest).mockResolvedValueOnce({ allowed: false, retryAfter: 20 });
    await expect(getTasteProfile('Patient')).rejects.toBeInstanceOf(AniListRateLimitError);
    expect(fetch).not.toHaveBeenCalled();
    expect((await getTasteProfile('Patient')).name).toBe('Patient');
  });
});

describe('years in anime', () => {
  const entry = (id: number, status: string, progress: number, score = 0) => ({
    status,
    score,
    progress,
    updatedAt: 0,
    completedAt: { month: 3 },
    media: {
      id,
      title: { romaji: `Anime ${id}` },
      coverImage: { large: null },
      isAdult: false,
      meanScore: 70,
      episodes: 24,
      duration: null,
      genres: ['Drama'],
    },
  });

  it('reads what was finished in the year, counting a rewatched anime in full', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          MediaListCollection: {
            user: { id: 7, name: 'Viewer', avatar: null, mediaListOptions: null },
            lists: [
              {
                isCustomList: false,
                entries: [entry(1, 'COMPLETED', 24, 8), entry(2, 'REPEATING', 3)],
              },
              // Custom lists repeat entries from the status lists
              { isCustomList: true, entries: [entry(1, 'COMPLETED', 24, 8)] },
            ],
          },
        },
      })
    );
    const year = await getAnimeYear('Viewer', 2026);
    expect(year.finished).toEqual([
      expect.objectContaining({ id: 1, score100: 80, episodes: 24, minutes: 24 * 24 }),
      expect.objectContaining({ id: 2, score100: null, episodes: 24, minutes: 24 * 24 }),
    ]);
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(init.headers).not.toHaveProperty('Authorization');
    // Finish dates are YYYYMMDD, and one with only its year YYYY0000, which still counts
    expect(JSON.parse(init.body as string).variables).toEqual({
      userName: 'viewer',
      after: 20259999,
      before: 20270000,
    });
    expect(takeAniListRequest).toHaveBeenCalledWith('spare');
  });

  it('never asks AniList for a name that cannot be one', async () => {
    await expect(getAnimeYear('two words', 2026)).rejects.toThrow(AniListNotFoundError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the ids on your other lists that come with your own Watching list', () => {
  const answer = (listed?: unknown) =>
    Response.json({
      data: {
        MediaListCollection: {
          user: { id: 7, name: 'Owner', avatar: null, mediaListOptions: null },
          lists: [],
        },
        ...(listed === undefined ? {} : { listed }),
      },
    });
  const list = (status: string | null, ids: number[], isCustomList = false) => ({
    status,
    isCustomList,
    entries: ids.map((mediaId) => ({ mediaId })),
  });
  const sent = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).query as string;

  it('reads them by list in the same request, each id once', async () => {
    vi.mocked(fetch).mockResolvedValue(
      answer({
        lists: [
          list('PLANNING', [1, 2]),
          // A completed list split by format is several lists
          list('COMPLETED', [3]),
          list('COMPLETED', [4, 3]),
          list('PAUSED', [5]),
          // Custom lists repeat anime from the status lists
          list(null, [1, 3], true),
        ],
      })
    );

    const read = await getWatchingEntries('Owner', 'token', undefined, true);

    expect(read.listedIds).toEqual({ PLANNING: [1, 2], COMPLETED: [3, 4], PAUSED: [5] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sent()).toContain('status_in: [PLANNING, COMPLETED, PAUSED, DROPPED]');
    expect(sent()).toContain('lists { status isCustomList entries { mediaId } }');
  });

  it("leaves them out of anyone else's list", async () => {
    vi.mocked(fetch).mockResolvedValue(answer());

    const read = await getWatchingEntries('Someone', 'token');

    expect(read).not.toHaveProperty('listedIds');
    expect(sent()).not.toContain('listed:');
  });

  it('reads empty lists as no ids', async () => {
    vi.mocked(fetch).mockResolvedValue(answer({ lists: [] }));

    expect((await getWatchingEntries('Owner', 'token', undefined, true)).listedIds).toEqual({});
  });
});

describe('planning lists', () => {
  const entry = (id: number, updatedAt = 0) => ({
    updatedAt,
    media: {
      id,
      idMal: id + 1000,
      title: { romaji: `Anime ${id}`, english: null },
      status: 'FINISHED',
      episodes: 12,
      coverImage: { medium: `https://s4.anilist.co/${id}.jpg` },
      isAdult: false,
      meanScore: 70,
    },
  });
  const collection = (name: string) =>
    Response.json({
      data: {
        MediaListCollection: {
          user: { id: 7, name },
          lists: [
            // Listed twice, as after a double import: the later edit stands
            { isCustomList: false, entries: [entry(1), entry(2, 10), entry(2, 20)] },
            // Custom lists repeat entries from the status lists
            { isCustomList: true, entries: [entry(1)] },
          ],
        },
      },
    });

  it('reads a planning list in one request, with only what its posters show', async () => {
    vi.mocked(fetch).mockResolvedValue(collection('Planner'));

    const list = await getPlanningEntries('Planner');

    expect(list.userId).toBe(7);
    expect(list.entries.map(({ media, updatedAt }) => [media.id, updatedAt])).toEqual([
      [1, 0],
      [2, 20],
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // A whole plan list can wait: it gives way to watching lists and saves
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
    const { query } = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(query).toContain('status_in: [PLANNING]');
    // Rows show the cover as a thumbnail, so the smallest one is enough
    expect(query).toContain('coverImage { medium }');
    // Genres fill the genre filter. The page orders prequels by airing date, and shows the year.
    // Every relation comes with what a sequel that isn't planned shows, as AniList can't send
    // sequels alone: no cover, dates or episodes
    expect(query).toMatch(/\bgenres\b/);
    expect(query).toContain('startDate { year month day }');
    expect(query).toContain(
      'relations { edges { relationType node { id type status isAdult title { romaji } } } }'
    );
    for (const field of ['synonyms', 'nextAiringEpisode', 'endDate', 'extraLarge', 'avatar'])
      expect(query).not.toContain(field);
  });

  it('keeps only the prequels and the anime sequels of what AniList relates', async () => {
    const node = (id: number, type = 'ANIME') => ({
      id,
      type,
      status: 'FINISHED',
      isAdult: false,
      title: { romaji: `Anime ${id}` },
    });
    const related = {
      ...entry(1),
      media: {
        ...entry(1).media,
        relations: {
          edges: [
            { relationType: 'PREQUEL', node: node(2) },
            { relationType: 'SEQUEL', node: node(3) },
            { relationType: 'SEQUEL', node: node(4, 'MANGA') },
            { relationType: 'ADAPTATION', node: node(5, 'MANGA') },
            { relationType: 'SIDE_STORY', node: node(6) },
          ],
        },
      },
    };
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          MediaListCollection: {
            user: { id: 7, name: 'Related' },
            lists: [{ isCustomList: false, entries: [related] }],
          },
        },
      })
    );

    const list = await getPlanningEntries('Related');

    expect(list.entries[0].media.relations?.edges.map(({ node }) => node.id)).toEqual([2, 3]);
  });

  it('keeps an anonymous read for five minutes, for every spelling of the name', async () => {
    vi.mocked(fetch).mockImplementation(async () => collection('Kept'));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await Promise.all([getPlanningEntries('Kept'), getPlanningEntries('KEPT')]);
    vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60 * 1000);
    await getPlanningEntries('kept');
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000);
    await getPlanningEntries('kept');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads with the viewer's token every time, and never keeps what it shows them", async () => {
    vi.mocked(fetch).mockImplementation(async () => collection('Private'));
    await getPlanningEntries('Private', 'viewer-token');
    await getPlanningEntries('Private', 'viewer-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toMatchObject({
      Authorization: 'Bearer viewer-token',
    });

    // An anonymous read afterwards doesn't get the viewer's view of the list
    await getPlanningEntries('Private');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls[2][1]!.headers).not.toHaveProperty('Authorization');
  });
});

describe('one entry, for adding from the search and undoing it', () => {
  const body = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);

  it("reads the owner's entry with what it holds, and none for an anime not on the list", async () => {
    const entry = { id: 900, status: 'CURRENT', progress: 3, score: 0, repeat: 1 };
    const dates = {
      startedAt: { year: 2026, month: 9, day: 1 },
      completedAt: { year: null, month: null, day: null },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ data: { Media: { mediaListEntry: { ...entry, ...dates } } } })
      )
      .mockResolvedValueOnce(Response.json({ data: { Media: { mediaListEntry: null } } }));

    // With its dates, so reverting a save that finished it can put them back
    expect(await getListEntry('token', 7)).toEqual({
      ...entry,
      startedAt: '2026-09-01',
      completedAt: null,
    });
    expect(body().query).toMatch(/id status progress score repeat\s+startedAt \{ year month day/);
    expect(await getListStatus('token', 7)).toBeNull();
  });

  it('deletes an entry by its own id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { DeleteMediaListEntry: { deleted: true } } })
    );

    await deleteEntry('token', 900);

    expect(body()).toMatchObject({ variables: { id: 900 } });
    expect(body().query).toContain('DeleteMediaListEntry(id: $id)');
  });
});

describe('sequels', () => {
  const node = (id: number, changes: Record<string, unknown> = {}) => ({
    id,
    idMal: id + 1000,
    type: 'ANIME',
    format: 'TV',
    status: 'FINISHED',
    episodes: 12,
    isAdult: false,
    title: { romaji: `Anime ${id}`, english: null },
    coverImage: { large: `https://img.example/${id}.jpg` },
    startDate: { year: 2020 + id, month: 4, day: null },
    mediaListEntry: null,
    ...changes,
  });

  it('keeps the anime sequels, once each, with where the viewer has them on their list', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          Media: {
            relations: {
              edges: [
                { relationType: 'PREQUEL', node: node(1) },
                {
                  relationType: 'SEQUEL',
                  node: node(2, { mediaListEntry: { status: 'PLANNING' } }),
                },
                { relationType: 'SEQUEL', node: node(2) },
                { relationType: 'SEQUEL', node: node(3, { type: 'MANGA' }) },
                { relationType: 'SIDE_STORY', node: node(4) },
                {
                  relationType: 'SEQUEL',
                  node: node(5, { idMal: null, status: null, isAdult: null, coverImage: null }),
                },
                // Nothing to show it by, so it's left out rather than failing the others
                { relationType: 'SEQUEL', node: node(6, { title: null }) },
              ],
            },
          },
        },
      })
    );

    expect(await getSequels(9, 'viewer.token')).toEqual([
      {
        id: 2,
        malId: 1002,
        title: 'Anime 2',
        englishTitle: null,
        coverUrl: 'https://img.example/2.jpg',
        isAdult: false,
        status: 'FINISHED',
        format: 'TV',
        episodes: 12,
        startDate: { year: 2022, month: 4, day: null },
        listStatus: 'PLANNING',
      },
      expect.objectContaining({
        id: 5,
        malId: null,
        coverUrl: null,
        isAdult: false,
        // Out already, as AniList gives no status
        status: 'FINISHED',
        startDate: { year: 2025, month: 4, day: null },
        listStatus: null,
      }),
    ]);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer viewer.token' });
    const { query, variables } = JSON.parse(init!.body as string);
    expect(variables).toEqual({ id: 9 });
    // An announced sequel says when it starts, as far as AniList knows
    expect(query).toContain('startDate { year month day }');
    // Only an offer, so it gives way when AniList is busy
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
  });

  it('copes with an anime AniList relates to nothing', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { Media: { relations: null } } }));

    expect(await getSequels(9)).toEqual([]);
  });
});

describe('tastes for the season page', () => {
  const answer = (name: string) =>
    Response.json({
      data: {
        User: {
          id: 7,
          name,
          statistics: {
            anime: {
              count: 3,
              meanScore: 70,
              standardDeviation: 10,
              genres: [{ genre: 'Drama', count: 2, meanScore: 80 }],
              tags: [],
              studios: [],
            },
          },
        },
        MediaListCollection: {
          lists: [
            {
              isCustomList: false,
              entries: [
                { mediaId: 1, status: 'COMPLETED', progress: 12, score: 80, updatedAt: 10 },
                { mediaId: 2, status: 'PLANNING', progress: null, score: null, updatedAt: 10 },
                // Imported twice: the entry changed last stands for it
                { mediaId: 3, status: 'DROPPED', progress: 1, score: 0, updatedAt: 10 },
                { mediaId: 3, status: 'COMPLETED', progress: 12, score: 60, updatedAt: 20 },
              ],
            },
            // A custom list repeats anime on a status list
            {
              isCustomList: true,
              entries: [
                { mediaId: 1, status: 'COMPLETED', progress: 12, score: 80, updatedAt: 10 },
              ],
            },
          ],
        },
      },
    });

  it('reads the statistics and the lists in one request, giving way when AniList is busy', async () => {
    vi.mocked(fetch).mockImplementation(async () => answer('Taster'));

    const { userId, userName, taste } = await getSeasonTaste('Taster');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
    const { query } = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(query).toContain('statistics');
    expect(query).toContain('score(format: POINT_100)');
    expect({ userId, userName }).toEqual({ userId: 7, userName: 'Taster' });
    expect(taste).toMatchObject({
      traits: [{ kind: 'genre', name: 'Drama', count: 2, lift: 1 }],
      listedIds: { COMPLETED: [1, 3], PLANNING: [2] },
      scores: [
        [1, 80],
        [3, 60],
      ],
      watched: 2,
    });
  });

  it("asks nothing for a name that can't be anyone's", async () => {
    await expect(getSeasonTaste('not a name!')).rejects.toBeInstanceOf(AniListNotFoundError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an anonymous read for ten minutes, for every spelling of the name', async () => {
    vi.mocked(fetch).mockImplementation(async () => answer('Kept'));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await Promise.all([getSeasonTaste('Kept'), getSeasonTaste('KEPT')]);
    vi.spyOn(Date, 'now').mockReturnValue(now + 9 * 60 * 1000);
    await getSeasonTaste('kept');
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
    await getSeasonTaste('kept');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads with the viewer's token every time, and never keeps what it shows them", async () => {
    vi.mocked(fetch).mockImplementation(async () => answer('Hidden'));
    await getSeasonTaste('Hidden', 'viewer-token');
    await getSeasonTaste('Hidden', 'viewer-token');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toMatchObject({
      Authorization: 'Bearer viewer-token',
    });

    await getSeasonTaste('Hidden');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls[2][1]!.headers).not.toHaveProperty('Authorization');
  });
});

describe('AniList notifications', () => {
  const user = (id: number, name: string, avatar: string | null = null) => ({
    id,
    name,
    avatar: { medium: avatar },
  });
  const media = (id: number, type: 'ANIME' | 'MANGA' = 'ANIME') => ({
    id,
    type,
    title: { romaji: `Title ${id}` },
    coverImage: { medium: `https://s4.anilist.co/cover/${id}.jpg` },
    isAdult: false,
  });

  function respond(notifications: unknown[], extra: Record<string, unknown> = {}) {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: { Page: { pageInfo: { hasNextPage: true }, notifications }, ...extra },
      })
    );
  }
  function sent() {
    return JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  }

  it('counts unread notifications with whatever budget is spare', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { Viewer: { unreadNotificationCount: 4 } } })
    );
    expect(await getUnreadNotificationCount('token')).toBe(4);
    expect(takeAniListRequest).toHaveBeenCalledWith('spare');
  });

  it('reads a page of every type and leaves the unread count alone', async () => {
    respond([]);
    expect(await getNotifications('token', { page: 2, markRead: false })).toEqual({
      notifications: [],
      hasNextPage: true,
    });
    expect(sent().variables).toEqual({ page: 2, markRead: false });
    expect(sent().query).toContain('resetNotificationCount: $markRead');
    // AniList fails with a server error when type_in is null, so it's never sent
    expect(sent().query).not.toContain('type_in');
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
  });

  it('says how many were unread when marking them read', async () => {
    respond([], { Viewer: { unreadNotificationCount: 3 } });
    const page = await getNotifications('token', { page: 1, markRead: true });
    expect(sent().variables).toEqual({ page: 1, markRead: true });
    expect(page.unread).toBe(3);
  });

  it('trims each kind of notification and links it from ids alone', async () => {
    respond([
      { id: 20, type: 'AIRING', createdAt: 1_700_000_000, episode: 7, media: media(1) },
      { id: 19, type: 'FOLLOWING', createdAt: 1, user: user(5, 'Alice', 'http://insecure/a.png') },
      { id: 18, type: 'ACTIVITY_LIKE', createdAt: 1, activityId: 77, user: user(5, 'Alice') },
      {
        id: 17,
        type: 'THREAD_COMMENT_REPLY',
        createdAt: 1,
        commentId: 9,
        thread: { id: 3, title: ' Fall 2026 ' },
        user: user(6, 'Bob', 'https://s4.anilist.co/avatar/6.png'),
      },
      { id: 16, type: 'THREAD_LIKE', createdAt: 1, threadId: 4, thread: null, user: null },
      {
        id: 15,
        type: 'MEDIA_MERGE',
        createdAt: 1,
        reason: 'Duplicate',
        deletedMediaTitles: ['Old one', null, ' '],
        media: media(2, 'MANGA'),
      },
      { id: 14, type: 'MEDIA_DELETION', createdAt: 1, deletedMediaTitle: 'Gone', reason: '' },
      {
        id: 13,
        type: 'MEDIA_SUBMISSION_UPDATE',
        createdAt: 1,
        status: 'ACCEPTED',
        notes: 'Thanks',
        submittedTitle: 'New show',
        media: null,
      },
      {
        id: 12,
        type: 'STAFF_SUBMISSION_UPDATE',
        createdAt: 1,
        staff: { id: 8, name: { full: 'Kana' } },
      },
    ]);
    const { notifications } = await getNotifications('token', { page: 1, markRead: false });
    expect(notifications).toEqual([
      {
        id: 20,
        type: 'AIRING',
        createdAt: 1_700_000_000_000,
        href: 'https://anilist.co/anime/1',
        media: {
          id: 1,
          title: 'Title 1',
          coverUrl: 'https://s4.anilist.co/cover/1.jpg',
          isAdult: false,
        },
        episode: 7,
      },
      {
        id: 19,
        type: 'FOLLOWING',
        createdAt: 1000,
        href: '/user/anilist/Alice',
        actor: { id: 5, name: 'Alice', avatarUrl: null },
      },
      {
        id: 18,
        type: 'ACTIVITY_LIKE',
        createdAt: 1000,
        href: 'https://anilist.co/activity/77',
        actor: { id: 5, name: 'Alice', avatarUrl: null },
      },
      {
        id: 17,
        type: 'THREAD_COMMENT_REPLY',
        createdAt: 1000,
        href: 'https://anilist.co/forum/thread/3/comment/9',
        actor: { id: 6, name: 'Bob', avatarUrl: 'https://s4.anilist.co/avatar/6.png' },
        subject: 'Fall 2026',
      },
      {
        id: 16,
        type: 'THREAD_LIKE',
        createdAt: 1000,
        href: 'https://anilist.co/forum/thread/4',
      },
      {
        id: 15,
        type: 'MEDIA_MERGE',
        createdAt: 1000,
        href: 'https://anilist.co/manga/2',
        media: {
          id: 2,
          title: 'Title 2',
          coverUrl: 'https://s4.anilist.co/cover/2.jpg',
          isAdult: false,
        },
        subject: 'Old one',
        reason: 'Duplicate',
      },
      { id: 14, type: 'MEDIA_DELETION', createdAt: 1000, href: null, subject: 'Gone' },
      {
        id: 13,
        type: 'MEDIA_SUBMISSION_UPDATE',
        createdAt: 1000,
        href: null,
        subject: 'New show',
        status: 'ACCEPTED',
        reason: 'Thanks',
      },
      {
        id: 12,
        type: 'STAFF_SUBMISSION_UPDATE',
        createdAt: 1000,
        href: 'https://anilist.co/staff/8',
        subject: 'Kana',
      },
    ]);
  });

  it("leaves out notifications it can't show", async () => {
    respond([
      null,
      {},
      { id: 3, type: 'SOMETHING_NEW', createdAt: 1 },
      { id: 0, type: 'AIRING', createdAt: 1 },
      { id: 4, type: 'AIRING', createdAt: null, episode: 2 },
      { id: 2, type: 'FOLLOWING', createdAt: 1, user: user(5, 'not a name!') },
    ]);
    const { notifications } = await getNotifications('token', { page: 1, markRead: false });
    // A name that couldn't be a list's address links nowhere rather than somewhere wrong
    expect(notifications).toEqual([
      {
        id: 2,
        type: 'FOLLOWING',
        createdAt: 1000,
        href: null,
        actor: { id: 5, name: 'not a name!', avatarUrl: null },
      },
    ]);
  });

  it('passes on a rejected token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: null, errors: [{ message: 'Invalid token' }] })
    );
    await expect(getNotifications('token', { page: 1, markRead: true })).rejects.toBeInstanceOf(
      AniListTokenError
    );
  });
});

describe("friends' activity", () => {
  const user = (id: number, name: string, avatar: string | null = null) => ({
    id,
    name,
    avatar: { medium: avatar },
  });
  const media = (id: number) => ({
    id,
    type: 'ANIME',
    title: { romaji: `Title ${id}` },
    coverImage: { medium: `https://s4.anilist.co/cover/${id}.jpg` },
    isAdult: false,
  });

  function respond(activities: unknown[]) {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { Page: { pageInfo: { hasNextPage: true }, activities } } })
    );
  }
  function sent() {
    return JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  }

  it("reads anime list updates from the people the viewer follows, leaving out the viewer's own", async () => {
    respond([]);
    expect(await getFriendActivity('token', { page: 2, viewerId: 10 })).toEqual({
      activities: [],
      hasNextPage: true,
    });
    expect(sent().variables).toEqual({ page: 2, viewerId: 10 });
    expect(sent().query).toContain('isFollowing: true');
    expect(sent().query).toContain('type: ANIME_LIST');
    expect(sent().query).toContain('userId_not: $viewerId');
    // Avatars are drawn small, so the smallest size, not the large one lists use
    expect(sent().query).toContain('avatar { medium }');
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toHaveProperty(
      'Authorization',
      'Bearer token'
    );
    expect(takeAniListRequest).toHaveBeenCalledWith('optional');
  });

  it("never asks without a token, as AniList would send everyone's activity", async () => {
    await expect(getFriendActivity('', { page: 1, viewerId: 10 })).rejects.toBeInstanceOf(
      AniListTokenError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims each update and links it from its id alone', async () => {
    respond([
      {
        id: 30,
        status: 'watched episode',
        progress: '3 - 5',
        createdAt: 1_700_000_000,
        likeCount: 2,
        replyCount: null,
        user: user(5, 'Alice', 'http://insecure/a.png'),
        media: media(1),
      },
      {
        id: 29,
        status: ' completed ',
        progress: ' ',
        createdAt: 1,
        likeCount: -1,
        replyCount: 1,
        user: user(6, 'Bob', 'https://s4.anilist.co/avatar/6.png'),
        media: { ...media(2), title: null, coverImage: null, isAdult: true },
      },
    ]);
    expect((await getFriendActivity('token', { page: 1, viewerId: 10 })).activities).toEqual([
      {
        id: 30,
        createdAt: 1_700_000_000_000,
        href: 'https://anilist.co/activity/30',
        user: { id: 5, name: 'Alice', avatarUrl: null },
        media: {
          id: 1,
          title: 'Title 1',
          coverUrl: 'https://s4.anilist.co/cover/1.jpg',
          isAdult: false,
        },
        status: 'watched episode',
        progress: '3 - 5',
        likes: 2,
        replies: 0,
      },
      {
        id: 29,
        createdAt: 1000,
        href: 'https://anilist.co/activity/29',
        user: { id: 6, name: 'Bob', avatarUrl: 'https://s4.anilist.co/avatar/6.png' },
        media: { id: 2, title: null, coverUrl: null, isAdult: true },
        status: 'completed',
        progress: null,
        likes: 0,
        replies: 1,
      },
    ]);
  });

  it("leaves out updates it can't show", async () => {
    const valid = { status: 'completed', createdAt: 1, user: user(5, 'Alice'), media: media(1) };
    respond([
      null,
      {},
      { ...valid, id: 0 },
      { ...valid, id: 1, createdAt: null },
      { ...valid, id: 2, status: ' ' },
      { ...valid, id: 3, user: null },
      { ...valid, id: 4, user: user(5, ' ') },
      { ...valid, id: 5, media: null },
      { ...valid, id: 6, media: { ...media(0) } },
      { ...valid, id: 7 },
    ]);
    const { activities } = await getFriendActivity('token', { page: 1, viewerId: 10 });
    expect(activities.map(({ id }) => id)).toEqual([7]);
  });

  it('passes on a rejected token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: null, errors: [{ message: 'Invalid token' }] })
    );
    await expect(getFriendActivity('token', { page: 1, viewerId: 10 })).rejects.toBeInstanceOf(
      AniListTokenError
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { takeAniListRequest } from '#lib/server/rate-limit.js';

vi.mock('#lib/server/rate-limit.js', () => ({
  fingerprint: (value: string) => value,
  takeAniListRequest: vi.fn(),
  pauseAniList: vi.fn(),
}));
let client: typeof import('./anilist-client.js');
const from = 1800000000;
const until = from + 28 * 86400;
const page = (
  rows: { mediaId: number; episode: number; airingAt: number }[] = [],
  hasNextPage = false
) => Response.json({ data: { Page: { pageInfo: { hasNextPage }, airingSchedules: rows } } });
const row = (mediaId = 1, episode = 3, airingAt = from + 100) => ({ mediaId, episode, airingAt });
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.mocked(takeAniListRequest).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => page())
  );
  client = await import('./anilist-client.js');
});

describe('four-week airing lookup', () => {
  it('batches deduplicated IDs, uses only public schedule fields, filters unrelated/out-of-window rows', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      page([row(), row(), row(2, 4), row(99), row(1, 1, from - 1), row(1, 9, until)])
    );
    const result = await client.getUpcomingAirings([2, 1, 2], from, until);
    expect(result).toMatchObject({
      episodes: [
        { mediaId: 1, episode: 3, airsAt: (from + 100) * 1000 },
        { mediaId: 2, episode: 4, airsAt: (from + 100) * 1000 },
      ],
      partial: false,
    });
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ ids: [1, 2], from: from - 1, until, page: 1 });
    expect(body.query).toContain('notYetAired: true');
    expect(body.query).toContain('perPage: 50');
    expect(body.query).not.toContain('MediaList');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(takeAniListRequest).toHaveBeenCalledWith(true);
  });
  it('loads multiple episodes per anime across pages and stops when complete', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row(1, 4, from + 200)], true))
      .mockResolvedValueOnce(page([row()]));
    const result = await client.getUpcomingAirings([1], from, until);
    expect(result.episodes.map((episode) => episode.episode)).toEqual([3, 4]);
    expect(result.partial).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('caches complete positive and negative coverage across overlapping lists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page([row()]));
    await client.getUpcomingAirings([1, 2], from, until);
    expect((await client.getUpcomingAirings([2], from, until)).episodes).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.getUpcomingAirings([1, 2, 3], from, until);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).variables.ids).toEqual([
      3,
    ]);
  });
  it('refreshes coverage after one hour', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await client.getUpcomingAirings([1], from, until);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    await client.getUpcomingAirings([1], from, until);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('coalesces identical concurrent lookups', async () => {
    await Promise.all([
      client.getUpcomingAirings([2, 1], from, until),
      client.getUpcomingAirings([1, 2], from, until),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serves stale airings during an outage for up to 24 hours without extending retention', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockResolvedValueOnce(page([row()]));
    await client.getUpcomingAirings([1], from, until);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const saved = await client.getUpcomingAirings([1], from, until);
    expect(saved).toMatchObject({
      stale: true,
      partial: true,
      partialReason: 'unavailable',
      fetchedAt: now,
    });
    expect(saved.episodes).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 86400000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(client.getUpcomingAirings([1], from, until)).rejects.toThrow('offline');
  });
  it('labels stale negative coverage rather than reporting a complete empty schedule during an outage', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await client.getUpcomingAirings([1], from, until);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await client.getUpcomingAirings([1], from, until)).toMatchObject({
      episodes: [],
      stale: true,
      partial: true,
      fetchedAt: now,
    });
  });
  it('caps pagination at four pages and never marks a partial lookup as complete coverage', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const { variables } = JSON.parse(init!.body as string);
      return page([row(1, variables.page)], true);
    });
    const result = await client.getUpcomingAirings([1], from, until);
    expect(result).toMatchObject({ partial: true, partialReason: 'limit' });
    expect(fetch).toHaveBeenCalledTimes(4);
    await client.getUpcomingAirings([1, 2], from, until);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[4][1]!.body as string).variables.ids).toEqual([
      1, 2,
    ]);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('retains returned airings when a later page is rate limited, then can complete on retry', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page([row()], true))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '30' } }));
    const result = await client.getUpcomingAirings([1], from, until);
    expect(result).toMatchObject({ partial: true, partialReason: 'unavailable', retryAfter: 30 });
    expect(result.episodes).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(page([row(1, 4)]));
    expect((await client.getUpcomingAirings([1], from, until)).partial).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('fails a first-page error without storing false empty coverage', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(client.getUpcomingAirings([1], from, until)).rejects.toThrow('offline');
    await client.getUpcomingAirings([1], from, until);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

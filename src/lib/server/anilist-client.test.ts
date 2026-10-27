import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  AniListTokenError,
  getFollowing,
  getLatestAirings,
  getViewer,
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

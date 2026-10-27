import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  AniListTokenError,
  getFriendsWatching,
  getSharedAnime,
} from '#lib/server/anilist-client.js';
import { takeAniListRequest } from '#lib/server/rate-limit.js';

vi.mock('#lib/server/rate-limit.js', () => ({
  fingerprint: (value: string) => value,
  takeAniListRequest: vi.fn(),
  pauseAniList: vi.fn(),
}));
const entry = (mediaId: number, userId: number, status = 'CURRENT') => ({
  mediaId,
  progress: 4,
  status,
  user: { id: userId, name: `Friend${userId}`, avatar: null },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeAniListRequest).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.stubGlobal('fetch', vi.fn());
});

describe('batched AniList friend matches', () => {
  it('queries followed users once for all anime, filters and deduplicates results', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          Page: {
            pageInfo: { hasNextPage: false },
            mediaList: [
              entry(1, 3),
              entry(1, 2, 'REPEATING'),
              entry(1, 2),
              entry(1, 10),
              entry(1, 4, 'COMPLETED'),
              entry(99, 2),
              entry(2, 2),
            ],
          },
        },
      })
    );
    const result = await getFriendsWatching('token', 10, [1, 2]);
    expect(result.partial).toBe(false);
    expect(result.matches[1].map((friend) => friend.id)).toEqual([2, 3]);
    expect(result.matches[1][0]).toMatchObject({ progress: 4, rewatching: true, avatarUrl: null });
    expect(result.matches[99]).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ ids: [1, 2], page: 1, viewerId: 10, includeViewer: true });
    expect(body.query).toContain('isFollowing: true');
    expect(body.query).toContain('status_in: [CURRENT, REPEATING]');
    expect(body.query).toContain('self: MediaListCollection');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  });
  it('includes the viewer first, with only matching Watching/Rewatching entries, in the same request', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          Viewer: { id: 10, name: 'ZViewer', avatar: { large: 'https://s4.anilist.co/me.jpg' } },
          self: {
            lists: [
              {
                isCustomList: false,
                entries: [
                  { mediaId: 1, progress: 6, status: 'CURRENT' },
                  { mediaId: 2, progress: 8, status: 'REPEATING' },
                  { mediaId: 3, progress: 12, status: 'COMPLETED' },
                  { mediaId: 99, progress: 1, status: 'CURRENT' },
                ],
              },
              { isCustomList: true, entries: [{ mediaId: 1, progress: 99, status: 'CURRENT' }] },
            ],
          },
          Page: { pageInfo: { hasNextPage: false }, mediaList: [entry(1, 2), entry(1, 10)] },
        },
      })
    );
    const result = await getFriendsWatching('token', 10, [1, 2, 3]);
    expect(result.matches[1].map((person) => person.id)).toEqual([10, 2]);
    expect(result.matches[1][0]).toMatchObject({
      isViewer: true,
      progress: 6,
      avatarUrl: 'https://s4.anilist.co/me.jpg',
    });
    expect(result.matches[2][0]).toMatchObject({ isViewer: true, rewatching: true, progress: 8 });
    expect(result.matches[3]).toBeUndefined();
    expect(result.matches[99]).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a mismatched session identity instead of labeling another person as You', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          Viewer: { id: 77, name: 'Other', avatar: null },
          self: { lists: [] },
          Page: { pageInfo: { hasNextPage: false }, mediaList: [] },
        },
      })
    );
    await expect(getFriendsWatching('token', 10, [1])).rejects.toBeInstanceOf(AniListTokenError);
  });
  it('stops after four pages and discloses remaining matches', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({
        data: {
          Page: {
            pageInfo: { hasNextPage: true },
            mediaList: [entry(1, 2)],
          },
        },
      })
    );
    const result = await getFriendsWatching('token', 10, [1]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.partial).toBe(true);
    expect(result.matches[1]).toHaveLength(1);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => JSON.parse(init!.body as string).variables.includeViewer)
    ).toEqual([true, false, false, false]);
  });
  it('returns empty results without using the upstream budget', async () => {
    expect(await getFriendsWatching('token', 10, [])).toEqual({ matches: {}, partial: false });
    expect(takeAniListRequest).not.toHaveBeenCalled();
  });
  it('propagates upstream limits', async () => {
    vi.mocked(takeAniListRequest).mockResolvedValue({ allowed: false, retryAfter: 30 });
    await expect(getFriendsWatching('token', 10, [1])).rejects.toBeInstanceOf(
      AniListRateLimitError
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps partial matches if pagination runs out of the optional budget', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          Page: {
            pageInfo: { hasNextPage: true },
            mediaList: [entry(1, 2)],
          },
        },
      })
    );
    vi.mocked(takeAniListRequest)
      .mockResolvedValueOnce({ allowed: true, retryAfter: 60 })
      .mockResolvedValueOnce({ allowed: false, retryAfter: 30 });
    const result = await getFriendsWatching('token', 10, [1]);
    expect(result.partial).toBe(true);
    expect(result.retryAfter).toBe(30);
    expect(result.matches[1]).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gets the own comparison list without airing enrichment or custom-list duplicates', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        data: {
          MediaListCollection: {
            lists: [
              {
                isCustomList: false,
                entries: [
                  {
                    media: {
                      id: 1,
                      title: { romaji: 'Anime' },
                      isAdult: true,
                      coverImage: { large: 'https://s4.anilist.co/cover.jpg' },
                    },
                  },
                ],
              },
              {
                isCustomList: true,
                entries: [{ media: { id: 1, title: { romaji: 'Anime' }, isAdult: true } }],
              },
            ],
          },
        },
      })
    );
    expect(await getSharedAnime('token', 10)).toEqual([
      { id: 1, title: 'Anime', isAdult: true, coverUrl: 'https://s4.anilist.co/cover.jpg' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).query).not.toContain(
      'airing'
    );
  });
});

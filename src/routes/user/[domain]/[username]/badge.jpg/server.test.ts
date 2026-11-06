import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListRateLimitError, getMediaByMalIds } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import {
  getWatchingEntries,
  MalForbiddenError,
  type MalEntry,
} from '#lib/server/myanimelist-client.js';
import { renderBadge } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { UserAnimeList } from '#lib/types/api.js';

import { GET } from './+server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/anilist.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist.js')>()),
  AniListApi: vi.fn(),
}));
vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getMediaByMalIds: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/myanimelist-client.js')>()),
  getWatchingEntries: vi.fn(),
}));
vi.mock('#lib/server/preview-image.js', () => ({
  renderBadge: vi.fn(async () => new Response('badge')),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));

const LIST: UserAnimeList = {
  userId: 1,
  username: 'Alice',
  avatarUrl: null,
  scoreFormat: 'POINT_10',
  animeList: [],
};
const getUserAnimeList = vi.fn();

function event(search = '', domain = 'anilist', username = 'alice') {
  return {
    params: { domain, username },
    url: new URL(`https://yousoro.test/user/${domain}/${username}/badge.jpg${search}`),
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(AniListApi).mockImplementation(function () {
    return { getUserAnimeList } as unknown as AniListApi;
  });
  getUserAnimeList.mockResolvedValue(LIST);
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
});

describe('profile badge image', () => {
  it('draws the public list in the asked colors, giving way first when AniList is busy', async () => {
    expect(await (await GET(event('?theme=dark'))).text()).toBe('badge');
    expect(getUserAnimeList).toHaveBeenCalledWith('alice', false, 'spare');
    expect(renderBadge).toHaveBeenCalledWith(
      LIST,
      'dark',
      expect.stringContaining('s-maxage=3600')
    );
  });

  it('draws light colors for anything else asked', async () => {
    await GET(event('?theme=neon'));
    expect(renderBadge).toHaveBeenCalledWith(LIST, 'light', expect.any(String));
  });

  it('draws the site’s badge for a few minutes when AniList is busy', async () => {
    getUserAnimeList.mockRejectedValue(new AniListRateLimitError(30));
    await GET(event());
    expect(renderBadge).toHaveBeenCalledWith(null, 'light', 'public, max-age=300, s-maxage=300');
  });

  it("draws a MyAnimeList list's badge, its reads giving way first on both services", async () => {
    const watching: MalEntry = {
      node: { id: 5114, title: 'Fullmetal Alchemist: Brotherhood' },
      list_status: {
        status: 'watching',
        score: 0,
        num_episodes_watched: 3,
        is_rewatching: false,
        updated_at: '2026-11-01T00:00:00+00:00',
      },
    };
    vi.mocked(getWatchingEntries).mockResolvedValue([watching]);
    vi.mocked(getMediaByMalIds).mockResolvedValue(new Map());

    expect(await (await GET(event('', 'myanimelist', 'Mika'))).text()).toBe('badge');
    expect(getWatchingEntries).toHaveBeenCalledWith('Mika', undefined, 'spare');
    expect(getMediaByMalIds).toHaveBeenCalledTimes(1);
    expect(getMediaByMalIds).toHaveBeenCalledWith([5114], 'spare');
    expect(AniListApi).not.toHaveBeenCalled();
    expect(renderBadge).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'Mika', avatarUrl: null }),
      'light',
      expect.stringContaining('s-maxage=3600')
    );
  });

  it("draws the site's badge for a private MyAnimeList list, without logging it", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getWatchingEntries).mockRejectedValue(new MalForbiddenError('private'));
    await GET(event('', 'myanimelist', 'Mika'));
    expect(renderBadge).toHaveBeenCalledWith(null, 'light', 'public, max-age=300, s-maxage=300');
    expect(log).not.toHaveBeenCalled();
  });

  it('knows no badge on another service', async () => {
    await expect(GET(event('', 'kitsu'))).rejects.toMatchObject({ status: 404 });
  });

  it('never lets the CDN keep a badge refused to one client', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });
    await GET(event());
    expect(getUserAnimeList).not.toHaveBeenCalled();
    expect(renderBadge).toHaveBeenCalledWith(null, 'light', 'no-store');
  });
});

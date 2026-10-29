import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListRateLimitError } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { renderBadge } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { UserAnimeList } from '#lib/types/api.js';

import { GET } from './+server.js';

vi.mock('#lib/server/anilist.js', () => ({ AniListApi: vi.fn() }));
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

function event(search = '') {
  return {
    params: { domain: 'anilist', username: 'alice' },
    url: new URL(`https://yousoro.test/user/anilist/alice/badge.jpg${search}`),
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

  it('never lets the CDN keep a badge refused to one client', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });
    await GET(event());
    expect(getUserAnimeList).not.toHaveBeenCalled();
    expect(renderBadge).toHaveBeenCalledWith(null, 'light', 'no-store');
  });
});

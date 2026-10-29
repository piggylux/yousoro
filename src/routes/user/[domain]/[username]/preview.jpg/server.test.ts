import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getWatchingEntries,
} from '#lib/server/anilist-client.js';
import { renderListPreview, renderSitePreview } from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getWatchingEntries: vi.fn(),
}));
vi.mock('#lib/server/preview-image.js', () => ({
  renderListPreview: vi.fn(async () => new Response('list')),
  renderSitePreview: vi.fn(async () => new Response('site')),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));

function event(domain = 'anilist') {
  return {
    params: { domain, username: 'Fixture' },
    // A signed-in viewer, whose token must never be used for a publicly cached image
    locals: { session: { token: 'viewer.token', user: { id: 2, name: 'Viewer' } } },
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getWatchingEntries).mockResolvedValue({
    userId: 1,
    userName: 'Fixture',
    avatarUrl: null,
    scoreFormat: 'POINT_10',
    entries: [],
  });
});

describe('list preview image', () => {
  it('draws the public list, never with the viewer’s token, and lets it be cached', async () => {
    expect(await (await GET(event())).text()).toBe('list');
    // At the usual priority: a shared list's preview is read rarely, unlike a badge
    expect(getWatchingEntries).toHaveBeenCalledWith('Fixture', undefined, undefined);
    expect(renderListPreview).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'Fixture', animeList: [] }),
      expect.stringContaining('s-maxage=3600')
    );
  });

  it.each([
    new AniListNotFoundError('Private or missing'),
    new AniListRateLimitError(30),
    new Error('AniList is down'),
  ])('shows the site preview briefly when the list can’t be read (%s)', async (error) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    vi.mocked(getWatchingEntries).mockRejectedValue(error);
    expect(await (await GET(event())).text()).toBe('site');
    expect(renderSitePreview).toHaveBeenCalledWith('public, max-age=300, s-maxage=300', 'jpeg');
  });

  it('shows a rate-limited client the site preview, uncached so others still get the list', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 60 });
    expect(await (await GET(event())).text()).toBe('site');
    expect(renderSitePreview).toHaveBeenCalledWith('no-store', 'jpeg');
    expect(getWatchingEntries).not.toHaveBeenCalled();
  });

  it('rejects unknown list services', async () => {
    await expect(GET(event('myanimelist'))).rejects.toMatchObject({ status: 404 });
  });
});

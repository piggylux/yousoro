import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListNotFoundError, getTasteProfile } from '#lib/server/anilist-client.js';
import {
  renderMatchInvitePreview,
  renderMatchPreview,
  renderSitePreview,
} from '#lib/server/preview-image.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import type { TasteProfile } from '#lib/types/match.js';

import { GET } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getTasteProfile: vi.fn(),
}));
vi.mock('#lib/server/preview-image.js', () => ({
  renderMatchPreview: vi.fn(async () => new Response('match')),
  renderMatchInvitePreview: vi.fn(async () => new Response('invite')),
  renderSitePreview: vi.fn(async () => new Response('site')),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));

const profile = (id: number, name: string): TasteProfile => ({
  id,
  name,
  avatarUrl: null,
  scoreFormat: 'POINT_10',
  scored: [],
  seen: [],
  planned: [],
});

function event(username: string, other: string) {
  return {
    params: { domain: 'anilist', username, other },
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
});

describe('match preview image', () => {
  it('draws the match of two people, and lets it be cached', async () => {
    vi.mocked(getTasteProfile).mockImplementation(async (name) =>
      name === 'Alice' ? profile(1, 'Alice') : profile(2, 'Bob')
    );
    expect(await (await GET(event('Alice', 'Bob'))).text()).toBe('match');
    expect(renderMatchPreview).toHaveBeenCalledWith(
      profile(1, 'Alice'),
      profile(2, 'Bob'),
      expect.stringContaining('s-maxage=3600')
    );
  });

  it('never compares anyone with themselves, drawing their invitation instead', async () => {
    // Two spellings AniList reads as one account
    vi.mocked(getTasteProfile).mockResolvedValue(profile(1, 'Alice'));
    expect(await (await GET(event('Alice', 'ALICE'))).text()).toBe('invite');
    expect(renderMatchInvitePreview).toHaveBeenCalledWith(
      profile(1, 'Alice'),
      expect.stringContaining('s-maxage=3600')
    );
    expect(renderMatchPreview).not.toHaveBeenCalled();
  });

  it('falls back to the site preview for a little while when a list cannot be read', async () => {
    vi.mocked(getTasteProfile).mockRejectedValue(new AniListNotFoundError('Private User'));
    expect(await (await GET(event('Alice', 'Bob'))).text()).toBe('site');
    expect(renderSitePreview).toHaveBeenCalledWith('public, max-age=300, s-maxage=300', 'jpeg');
  });
});

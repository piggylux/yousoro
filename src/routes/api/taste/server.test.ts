import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getTasteProfile,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './[username]/+server.js';

vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getTasteProfile: vi.fn(),
}));

const PROFILE = {
  id: 1,
  name: 'Alice',
  avatarUrl: null,
  scoreFormat: 'POINT_10' as const,
  scored: [],
  seen: [],
  planned: [],
};

function event() {
  return {
    params: { username: 'alice' },
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent<{ username: string }, '/api/taste/[username]'>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getTasteProfile).mockResolvedValue(PROFILE);
});

describe('taste profile endpoint', () => {
  it('lets the CDN keep a profile for an hour, and serve it stale while it reads it again', async () => {
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PROFILE);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    );
  });

  it('keeps a missing or private list briefly, as a new account may come soon', async () => {
    vi.mocked(getTasteProfile).mockRejectedValue(new AniListNotFoundError('Private User'));
    const response = await GET(event());
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
  });

  it('never keeps a busy answer, for this client or for AniList', async () => {
    const request = event();
    vi.mocked(getTasteProfile).mockRejectedValue(new AniListRateLimitError(25));
    const busy = await GET(request);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect(request.locals.retryAfter).toBe(25);

    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 40 });
    const limited = await GET(event());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect(getTasteProfile).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getTasteProfile).mockRejectedValue(new Error('AniList API returned 500'));
    const response = await GET(event());
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

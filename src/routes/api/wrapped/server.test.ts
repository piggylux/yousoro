import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getAnimeYear,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './[username]/[year]/+server.js';

vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getAnimeYear: vi.fn(),
}));

const YEAR = {
  id: 1,
  name: 'Alice',
  avatarUrl: null,
  scoreFormat: 'POINT_10' as const,
  year: 2026,
  finished: [],
};

function event(year = '2026') {
  return {
    params: { username: 'alice', year },
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent<
    { username: string; year: string },
    '/api/wrapped/[username]/[year]'
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getAnimeYear).mockResolvedValue(YEAR);
});

describe('year in anime endpoint', () => {
  it('lets the CDN keep a year for an hour, as it does taste profiles', async () => {
    const response = await GET(event());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(YEAR);
    expect(getAnimeYear).toHaveBeenCalledWith('alice', 2026);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    );
  });

  it('never reads AniList for a year that cannot have finish dates', async () => {
    for (const year of ['1999', '3000', '26', 'next']) {
      const thrown = await Promise.resolve()
        .then(() => GET(event(year)))
        .catch((err: unknown) => err);
      expect(isHttpError(thrown, 404)).toBe(true);
    }
    expect(takeClientLimit).not.toHaveBeenCalled();
    expect(getAnimeYear).not.toHaveBeenCalled();
  });

  it('keeps a missing or private list briefly, and never a busy answer', async () => {
    vi.mocked(getAnimeYear).mockRejectedValue(new AniListNotFoundError('Private User'));
    const missing = await GET(event());
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');

    const request = event();
    vi.mocked(getAnimeYear).mockRejectedValue(new AniListRateLimitError(25));
    const busy = await GET(request);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect(request.locals.retryAfter).toBe(25);
  });
});

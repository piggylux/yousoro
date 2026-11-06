import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListNotFoundError,
  AniListRateLimitError,
  getTasteProfile,
} from '#lib/server/anilist-client.js';
import {
  getTasteProfile as getMalTasteProfile,
  MalForbiddenError,
  MalRateLimitError,
} from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './[domain]/[username]/+server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getTasteProfile: vi.fn(),
}));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getTasteProfile: vi.fn(),
}));

const PROFILE = {
  domain: 'anilist' as const,
  id: 1,
  name: 'Alice',
  avatarUrl: null,
  scoreFormat: 'POINT_10' as const,
  scored: [],
  seen: [],
  planned: [],
};

function event(domain = 'anilist', username = 'alice') {
  return {
    params: { domain, username },
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent<
    { domain: string; username: string },
    '/api/taste/[domain]/[username]'
  >;
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

  it('reads a MyAnimeList list, keeping the name as it was asked for', async () => {
    const mal = { ...PROFILE, domain: 'myanimelist' as const, id: null, name: 'mika' };
    vi.mocked(getMalTasteProfile).mockResolvedValue(mal);
    const response = await GET(event('myanimelist', 'mika'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(mal);
    expect(getMalTasteProfile).toHaveBeenCalledWith('mika');
    expect(getTasteProfile).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    );
  });

  it('keeps a private MyAnimeList list briefly, and never a busy answer, naming the service', async () => {
    vi.mocked(getMalTasteProfile).mockRejectedValue(new MalForbiddenError('private'));
    const missing = await GET(event('myanimelist', 'mika'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    expect((await missing.json()).message).toBe("There's no public MyAnimeList list for mika");

    vi.mocked(getMalTasteProfile).mockRejectedValue(new MalRateLimitError(30));
    const busy = await GET(event('myanimelist', 'mika'));
    expect(busy.status).toBe(429);
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
    expect((await busy.json()).message).toBe('MyAnimeList is busy, please try again shortly');
  });

  it("knows no service but AniList's and MyAnimeList's", async () => {
    const response = await GET(event('kitsu'));
    expect(response.status).toBe(404);
    expect(takeClientLimit).not.toHaveBeenCalled();
  });

  it('never keeps a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getTasteProfile).mockRejectedValue(new Error('AniList API returned 500'));
    const response = await GET(event());
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

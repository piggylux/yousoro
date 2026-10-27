import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListTokenError,
  AniListRateLimitError,
  getFriendsWatching,
  getSharedAnime,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

import { GET, POST } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getFriendsWatching: vi.fn(),
  getSharedAnime: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/session.js', () => ({ clearSession: vi.fn() }));

function event(mediaIds: unknown = [1, 2]) {
  return {
    locals: { session: { token: 'token', user: { id: 10 } } },
    cookies: {},
    getClientAddress: () => '127.0.0.1',
    request: new Request('https://example.test/api/friends/watching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaIds }),
    }),
  } as unknown as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getFriendsWatching).mockResolvedValue({ matches: {}, partial: false });
  vi.mocked(getSharedAnime).mockResolvedValue([]);
});

describe('friends watching endpoint', () => {
  it('requires authentication before any upstream work', async () => {
    const request = event();
    request.locals.session = null;
    await expect(POST(request)).rejects.toMatchObject({ status: 401 });
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    expect(takeClientLimit).not.toHaveBeenCalled();
  });
  it.each(
    [
      [0],
      [-1],
      [1.5],
      ['1'],
      [1, 1],
      [2147483648],
      Array.from({ length: 501 }, (_, i) => i + 1),
      null,
    ].map((ids) => ({ ids }))
  )('rejects invalid input $ids', async ({ ids }) => {
    await expect(POST(event(ids))).rejects.toMatchObject({ status: 400 });
    expect(getFriendsWatching).not.toHaveBeenCalled();
  });
  it('uses session identity and accepts the maximum batch', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    expect(await (await POST(event(ids))).json()).toEqual({ matches: {}, partial: false });
    expect(getFriendsWatching).toHaveBeenCalledWith('token', 10, ids);
  });
  it('fetches the viewer list for comparisons', async () => {
    await GET(event());
    expect(getSharedAnime).toHaveBeenCalledWith('token', 10);
  });
  it('propagates retry timing without querying AniList when locally limited', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(getFriendsWatching).not.toHaveBeenCalled();
  });
  it('preserves upstream rate limits', async () => {
    vi.mocked(getFriendsWatching).mockRejectedValue(new AniListRateLimitError(30));
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
  });
  it('clears an expired session', async () => {
    vi.mocked(getFriendsWatching).mockRejectedValue(new AniListTokenError());
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 401 });
    expect(clearSession).toHaveBeenCalledWith(request.cookies);
    expect(request.locals.session).toBeNull();
  });
  it('returns a recoverable upstream error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getFriendsWatching).mockRejectedValue(new Error('offline'));
    await expect(POST(event())).rejects.toMatchObject({ status: 502 });
    vi.restoreAllMocks();
  });
});

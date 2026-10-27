import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListRateLimitError, getUpcomingAirings } from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { POST } from './+server.js';
vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getUpcomingAirings: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
const from = Math.floor(Date.now() / 1000) - 86400;
const until = from + 28 * 86400;
function event(body: unknown = { mediaIds: [1, 2], from, until }) {
  return {
    locals: { session: null },
    getClientAddress: () => '127.0.0.1',
    request: new Request('https://example.test/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getUpcomingAirings).mockResolvedValue({ episodes: [], partial: false });
});
describe('schedule endpoint', () => {
  it('supports public lists without a token and accepts 500 IDs', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    expect(await (await POST(event({ mediaIds: ids, from, until }))).json()).toEqual({
      episodes: [],
      partial: false,
    });
    expect(getUpcomingAirings).toHaveBeenCalledWith(ids, from, until);
  });
  it.each([
    null,
    {},
    { mediaIds: [1, 1], from, until },
    { mediaIds: [0], from, until },
    { mediaIds: ['1'], from, until },
    { mediaIds: [1.5], from, until },
    { mediaIds: [2147483648], from, until },
    { mediaIds: Array.from({ length: 501 }, (_, i) => i + 1), from, until },
    { mediaIds: [1], from, until: from },
    { mediaIds: [1], from, until: from + 30 * 86400 },
    { mediaIds: [1], from: from - 10 * 86400, until },
    { mediaIds: [1], from: String(from), until },
  ])('rejects invalid input before upstream work: %j', async (body) => {
    await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
    expect(getUpcomingAirings).not.toHaveBeenCalled();
  });
  it('honors per-client limits without an upstream query', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(getUpcomingAirings).not.toHaveBeenCalled();
  });
  it('preserves upstream cooldown and partial-result timing', async () => {
    vi.mocked(getUpcomingAirings).mockRejectedValueOnce(new AniListRateLimitError(30));
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
    vi.mocked(getUpcomingAirings).mockResolvedValueOnce({
      episodes: [],
      partial: true,
      retryAfter: 10,
    });
    const partial = event();
    expect(await (await POST(partial)).json()).toMatchObject({ partial: true });
    expect(partial.locals.retryAfter).toBe(10);
  });
  it('returns a recoverable error instead of an empty schedule on upstream failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getUpcomingAirings).mockRejectedValueOnce(new Error('offline'));
    await expect(POST(event())).rejects.toMatchObject({ status: 502 });
    vi.restoreAllMocks();
  });
});

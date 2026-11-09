import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withMalToken } from '#lib/server/myanimelist-auth.js';
import { getListedIds, MalRateLimitError, MalTokenError } from '#lib/server/myanimelist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './+server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/myanimelist-auth.js', () => ({ withMalToken: vi.fn() }));
vi.mock('#lib/server/myanimelist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/myanimelist-client.js')>()),
  getListedIds: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));

const malSession = { token: 'mal-token', refreshToken: 'refresh', expiresAt: 0, user: {} };

function event(signedIn = true) {
  const deleted: string[] = [];
  const request = {
    locals: { session: null, malSession: signedIn ? malSession : null },
    cookies: { delete: (name: string) => void deleted.push(name) },
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0] & RequestEvent;
  return { request, deleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(withMalToken).mockImplementation((_event, use) => use('mal-token'));
});

describe('your other MyAnimeList lists, for the anime search', () => {
  it('gives the MyAnimeList ids on each', async () => {
    vi.mocked(getListedIds).mockResolvedValue({ PLANNING: [52991], COMPLETED: [1, 2] });

    const response = await GET(event().request);

    expect(await response.json()).toEqual({
      listedIds: { PLANNING: [52991], COMPLETED: [1, 2] },
    });
    expect(getListedIds).toHaveBeenCalledWith('mal-token');
  });

  it('asks to sign in with MyAnimeList first, without asking MyAnimeList', async () => {
    await expect(GET(event(false).request)).rejects.toMatchObject({ status: 401 });
    expect(getListedIds).not.toHaveBeenCalled();
  });

  it('says when MyAnimeList is busy, and signs out once the sign-in has expired', async () => {
    vi.mocked(getListedIds).mockRejectedValueOnce(new MalRateLimitError(30));
    await expect(GET(event().request)).rejects.toMatchObject({ status: 429 });

    vi.mocked(getListedIds).mockRejectedValueOnce(new MalTokenError('expired'));
    const { request, deleted } = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    expect(deleted).toEqual(['session_mal']);
  });
});

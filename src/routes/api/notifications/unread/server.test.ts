import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  AniListTokenError,
  getUnreadNotificationCount,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { GET } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getUnreadNotificationCount: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));

function event() {
  return {
    locals: { session: { token: 'token', user: { id: 10 } } },
    cookies: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent & Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
});

describe('unread notifications endpoint', () => {
  it('requires an AniList sign-in before any upstream work', async () => {
    const request = event();
    request.locals.session = null;
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    expect(takeClientLimit).not.toHaveBeenCalled();
  });

  it('counts the unread notifications', async () => {
    expect(await (await GET(event())).json()).toEqual({ unread: 3 });
    expect(getUnreadNotificationCount).toHaveBeenCalledWith('token');
  });

  it('says when to try again without asking AniList when the client is limited', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it('passes on when AniList is busy', async () => {
    vi.mocked(getUnreadNotificationCount).mockRejectedValue(new AniListRateLimitError(30));
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
  });

  it("doesn't sign anyone out from a check they didn't ask for", async () => {
    vi.mocked(getUnreadNotificationCount).mockRejectedValue(new AniListTokenError('Invalid token'));
    const response = await GET(event());
    expect(response.status).toBe(204);
  });

  it('reports other failures as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getUnreadNotificationCount).mockRejectedValue(new Error('boom'));
    await expect(GET(event())).rejects.toMatchObject({ status: 502 });
  });
});

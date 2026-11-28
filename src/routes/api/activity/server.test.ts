import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  AniListTokenError,
  getFriendActivity,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

import { GET } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getFriendActivity: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/session.js', () => ({ clearSession: vi.fn() }));

const PAGE = { activities: [], hasNextPage: false };

function event(search = '') {
  return {
    locals: { session: { token: 'token', user: { id: 10 } } },
    cookies: {},
    getClientAddress: () => '127.0.0.1',
    url: new URL(`https://example.test/api/activity${search}`),
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getFriendActivity).mockResolvedValue(PAGE);
});

describe('friend activity endpoint', () => {
  it('requires an AniList sign-in before any upstream work', async () => {
    const request = event();
    request.locals.session = null;
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    expect(takeClientLimit).not.toHaveBeenCalled();
  });

  it('reads the first page for the signed-in viewer', async () => {
    expect(await (await GET(event())).json()).toEqual(PAGE);
    expect(getFriendActivity).toHaveBeenCalledWith('token', { page: 1, viewerId: 10 });
  });

  it('reads the page asked for', async () => {
    await GET(event('?page=3'));
    expect(getFriendActivity).toHaveBeenCalledWith('token', { page: 3, viewerId: 10 });
  });

  it('offers no page past the last one it serves', async () => {
    vi.mocked(getFriendActivity).mockResolvedValue({ activities: [], hasNextPage: true });
    expect(await (await GET(event('?page=50'))).json()).toEqual({
      activities: [],
      hasNextPage: false,
    });
    expect(await (await GET(event('?page=49'))).json()).toEqual({
      activities: [],
      hasNextPage: true,
    });
  });

  it.each(['?page=0', '?page=51', '?page=1.5', '?page=two', '?page='])(
    'rejects %s',
    async (search) => {
      await expect(GET(event(search))).rejects.toMatchObject({ status: 400 });
      expect(getFriendActivity).not.toHaveBeenCalled();
    }
  );

  it('says when to try again without asking AniList when the client is limited', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(getFriendActivity).not.toHaveBeenCalled();
  });

  it('passes on when AniList is busy', async () => {
    vi.mocked(getFriendActivity).mockRejectedValue(new AniListRateLimitError(30));
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
  });

  it('signs out a sign-in AniList no longer accepts', async () => {
    vi.mocked(getFriendActivity).mockRejectedValue(new AniListTokenError('Invalid token'));
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    expect(clearSession).toHaveBeenCalled();
    expect(request.locals.session).toBeNull();
  });

  it('reports other failures as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getFriendActivity).mockRejectedValue(new Error('boom'));
    await expect(GET(event())).rejects.toMatchObject({ status: 502 });
  });
});

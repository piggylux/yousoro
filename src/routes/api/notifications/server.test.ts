import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AniListRateLimitError,
  AniListTokenError,
  getNotifications,
} from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';

import { GET, POST } from './+server.js';

vi.mock('#lib/server/anilist-client.js', async (original) => ({
  ...(await original<typeof import('#lib/server/anilist-client.js')>()),
  getNotifications: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/session.js', () => ({ clearSession: vi.fn() }));

const PAGE = { notifications: [], hasNextPage: false };

function event({
  search = '',
  body = {},
  contentType = 'application/json',
}: { search?: string; body?: unknown; contentType?: string } = {}) {
  return {
    locals: { session: { token: 'token', user: { id: 10 } } },
    cookies: {},
    getClientAddress: () => '127.0.0.1',
    url: new URL(`https://example.test/api/notifications${search}`),
    request: new Request('https://example.test/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getNotifications).mockResolvedValue(PAGE);
});

describe('notifications endpoint', () => {
  it('requires an AniList sign-in before any upstream work', async () => {
    const request = event();
    request.locals.session = null;
    await expect(GET(request)).rejects.toMatchObject({ status: 401 });
    await expect(POST(request)).rejects.toMatchObject({ status: 401 });
    expect(takeClientLimit).not.toHaveBeenCalled();
  });

  it('reads the first page without marking it read', async () => {
    expect(await (await GET(event())).json()).toEqual(PAGE);
    expect(getNotifications).toHaveBeenCalledWith('token', { page: 1, markRead: false });
  });

  it('reads the page asked for', async () => {
    await GET(event({ search: '?page=3' }));
    expect(getNotifications).toHaveBeenCalledWith('token', { page: 3, markRead: false });
  });

  it('offers no page past the last one it serves', async () => {
    vi.mocked(getNotifications).mockResolvedValue({ notifications: [], hasNextPage: true });
    expect(await (await GET(event({ search: '?page=100' }))).json()).toEqual({
      notifications: [],
      hasNextPage: false,
    });
    expect(await (await GET(event({ search: '?page=99' }))).json()).toEqual({
      notifications: [],
      hasNextPage: true,
    });
  });

  it('reads the first page and marks them read when posted to', async () => {
    await POST(event());
    expect(getNotifications).toHaveBeenCalledWith('token', { page: 1, markRead: true });
  });

  it('only marks them read from JSON, which other sites cannot send', async () => {
    await expect(
      POST(event({ contentType: 'application/x-www-form-urlencoded' }))
    ).rejects.toMatchObject({ status: 415 });
    expect(getNotifications).not.toHaveBeenCalled();
  });

  it.each(['?page=0', '?page=101', '?page=1.5', '?page=two', '?page='])(
    'rejects %s',
    async (search) => {
      await expect(GET(event({ search }))).rejects.toMatchObject({ status: 400 });
      expect(getNotifications).not.toHaveBeenCalled();
    }
  );

  it('says when to try again without asking AniList when the client is limited', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(getNotifications).not.toHaveBeenCalled();
  });

  it('passes on when AniList is busy', async () => {
    vi.mocked(getNotifications).mockRejectedValue(new AniListRateLimitError(30));
    const request = event();
    await expect(GET(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(30);
  });

  it('signs out a sign-in AniList no longer accepts', async () => {
    vi.mocked(getNotifications).mockRejectedValue(new AniListTokenError('Invalid token'));
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 401 });
    expect(clearSession).toHaveBeenCalled();
    expect(request.locals.session).toBeNull();
  });

  it('reports other failures as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getNotifications).mockRejectedValue(new Error('boom'));
    await expect(GET(event())).rejects.toMatchObject({ status: 502 });
  });
});

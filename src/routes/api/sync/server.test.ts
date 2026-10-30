import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MalSession, Session } from '#lib/server/session.js';
import { applySyncChanges } from '#lib/server/sync.js';

import { POST } from './+server';

vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/sync.js')>()),
  applySyncChanges: vi.fn(),
}));
// Sync is switched off for now; these tests cover it as it works once it's back on
const sync = vi.hoisted(() => ({ enabled: true }));
vi.mock('#lib/sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/sync.js')>()),
  get SYNC_ENABLED() {
    return sync.enabled;
  },
}));

const user = { id: 1, name: 'Fixture', avatarUrl: null };
const session: Session = { token: 'anilist.token.jwt', user };
const malSession: MalSession = { token: 'mal', refreshToken: 'r', expiresAt: Infinity, user };

function change(mediaId: number, to = 'anilist') {
  return {
    mediaId,
    malId: mediaId + 100,
    to,
    entry: { status: 'CURRENT', progress: 1, score100: 0 },
  };
}

function post(body: unknown, { linked = true, type = 'application/json' } = {}) {
  const request = new Request('http://localhost/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: JSON.stringify(body),
  });
  return POST({
    request,
    locals: { session, malSession: linked ? malSession : null },
    cookies: {} as Cookies,
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  sync.enabled = true;
});

describe('POST /api/sync', () => {
  it('isn’t there while sync is switched off', async () => {
    sync.enabled = false;

    await expect(post({ changes: [change(1)] })).rejects.toMatchObject({ status: 404 });
    expect(applySyncChanges).not.toHaveBeenCalled();
  });

  it('applies the changes and says how each went', async () => {
    vi.mocked(applySyncChanges).mockResolvedValue({
      results: [true, null],
      busy: { service: 'MyAnimeList', retryAfter: 20 },
    });

    const response = await post({ changes: [change(1), change(2, 'myanimelist')] });

    expect(await response.json()).toEqual({
      results: [true, null],
      busy: { service: 'MyAnimeList', retryAfter: 20 },
    });
    expect(vi.mocked(applySyncChanges).mock.calls[0][1]).toHaveLength(2);
  });

  it('takes up to ten changes at once', async () => {
    await expect(post({ changes: Array(11).fill(change(1)) })).rejects.toMatchObject({
      status: 400,
    });
  });

  it.each([
    ['not signed in to both', { changes: [change(1)] }, { linked: false }, 401],
    ['sent as a form', { changes: [change(1)] }, { type: 'text/plain' }, 415],
    ['an invalid change', { changes: [{ ...change(1), to: 'kitsu' }] }, {}, 400],
  ])('refuses a request %s', async (_, body, options, status) => {
    await expect(post(body, options)).rejects.toMatchObject({ status });
    expect(applySyncChanges).not.toHaveBeenCalled();
  });
});

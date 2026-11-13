import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AniListTokenError } from '#lib/server/anilist-client.js';
import { MalRateLimitError } from '#lib/server/myanimelist-client.js';
import type { MalSession, Session } from '#lib/server/session.js';
import { getSyncPlan } from '#lib/server/sync.js';
import { differenceKey, type SyncItem } from '#lib/sync.js';

import { GET } from './+server';

vi.mock('#lib/server/rate-limit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/rate-limit.js')>()),
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/myanimelist-auth.js', () => ({ MAL_ENABLED: true }));
vi.mock('#lib/server/sync.js', () => ({ getSyncPlan: vi.fn() }));

const user = { id: 1, name: 'Fixture', avatarUrl: null };
const session: Session = { token: 'anilist.token.jwt', user };
const malSession: MalSession = { token: 'mal', refreshToken: 'r', expiresAt: Infinity, user };
const deleted: string[] = [];

function get({ linked = true } = {}) {
  const locals = { session, malSession: linked ? malSession : null } as App.Locals;
  const response = GET({
    locals,
    cookies: { delete: (name: string) => void deleted.push(name) } as unknown as Cookies,
    getClientAddress: () => '127.0.0.1',
  } as unknown as Parameters<typeof GET>[0]);
  return { response, locals };
}

const item: SyncItem = {
  mediaId: 1,
  malId: 101,
  title: 'Fixture',
  coverUrl: null,
  isAdult: false,
  anilist: null,
  myanimelist: {
    status: 'CURRENT',
    progress: 1,
    score100: 0,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
  },
  to: 'anilist',
};

beforeEach(() => {
  vi.clearAllMocks();
  deleted.length = 0;
});

describe('GET /api/sync/status', () => {
  it('says how the lists differ, reading them with what’s left of the shared requests', async () => {
    vi.mocked(getSyncPlan).mockResolvedValue({ items: [item], unmatched: [] });

    const response = await get().response;

    expect(await response.json()).toEqual({ keys: [differenceKey(item)] });
    expect(vi.mocked(getSyncPlan).mock.calls[0][1]).toBe('spare');
  });

  it('needs both sign-ins', async () => {
    await expect(get({ linked: false }).response).rejects.toMatchObject({ status: 401 });
    expect(getSyncPlan).not.toHaveBeenCalled();
  });

  it('says when to ask again while a service is busy', async () => {
    vi.mocked(getSyncPlan).mockRejectedValue(new MalRateLimitError(40));

    const { response, locals } = get();

    await expect(response).rejects.toMatchObject({ status: 429 });
    expect(locals.retryAfter).toBe(40);
  });

  it('answers nothing, and signs no one out, when a sign-in has expired', async () => {
    vi.mocked(getSyncPlan).mockRejectedValue(new AniListTokenError('Invalid token'));

    const { response, locals } = get();

    expect((await response).status).toBe(204);
    expect(deleted).toEqual([]);
    expect(locals.session).toBe(session);
  });
});

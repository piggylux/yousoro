import type { Cookies, ServerLoadEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_LOAD_WAIT_MS } from '#lib/first-load.js';
import { MalRenewalDeferredError, renewMalTokenIfExpiring } from '#lib/server/myanimelist-auth.js';
import { clearMalSession } from '#lib/server/session.js';
import { getSyncPlan } from '#lib/server/sync.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { load } from './+page.server.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/myanimelist-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-auth.js')>()),
  MAL_ENABLED: true,
  renewMalTokenIfExpiring: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock('#lib/server/session.js', () => ({ clearSession: vi.fn(), clearMalSession: vi.fn() }));
vi.mock('#lib/server/sync.js', () => ({ getSyncPlan: vi.fn() }));

const PLAN = { items: [], unmatched: [] };
const user = { id: 1, name: 'Fixture', avatarUrl: null };

function event(isDataRequest = false) {
  return {
    locals: {
      session: { token: 'a.b.c', user },
      malSession: { token: 'mal', refreshToken: 'refresh', expiresAt: Date.now(), user },
      preferences: DEFAULT_PREFERENCES,
    },
    cookies: {} as Cookies,
    getClientAddress: () => '127.0.0.1',
    isDataRequest,
  } as unknown as Parameters<typeof load>[0] & ServerLoadEvent;
}

/** The load, which may answer at once, as a promise */
const run = (from: ReturnType<typeof event>) => Promise.resolve(load(from));

/** Whether the load has settled once the clock has moved on by `ms` */
async function settledAfter(pending: Promise<unknown>, ms: number) {
  let settled = false;
  pending.then(
    () => (settled = true),
    () => (settled = true)
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('a first load of the sync page', () => {
  it('shows both lists when they arrive in time', async () => {
    vi.mocked(getSyncPlan).mockResolvedValue(PLAN);
    expect(await run(event())).toEqual({ linked: true, ...PLAN });
  });

  it('renews a sign-in about to expire first, then reads without renewing it', async () => {
    vi.mocked(getSyncPlan).mockResolvedValue(PLAN);
    const first = event();
    await run(first);
    expect(renewMalTokenIfExpiring).toHaveBeenCalledWith(first);
    expect(vi.mocked(renewMalTokenIfExpiring).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getSyncPlan).mock.invocationCallOrder[0]
    );
    expect(getSyncPlan).toHaveBeenCalledWith(first, 'optional', { renew: false });
  });

  it('answers with the page in outline when the lists take long', async () => {
    vi.mocked(getSyncPlan).mockReturnValue(new Promise(() => {}));
    const failed = run(event()).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS);
    expect(await failed).toMatchObject({ status: 503, body: { loading: true } });
  });

  it("leaves a sign-in that needs renewing to the browser's read, without signing out", async () => {
    vi.mocked(getSyncPlan).mockRejectedValue(new MalRenewalDeferredError('needs renewing'));
    expect(await run(event()).catch((err: unknown) => err)).toMatchObject({
      status: 503,
      body: { loading: true },
    });
    expect(clearMalSession).not.toHaveBeenCalled();
  });
});

describe('the sync page read from the browser', () => {
  it('waits for both lists, renewing the sign-in as it needs to', async () => {
    vi.mocked(getSyncPlan).mockReturnValue(new Promise(() => {}));
    const read = event(true);
    expect(await settledAfter(run(read), PAGE_LOAD_WAIT_MS * 2)).toBe(false);
    expect(getSyncPlan).toHaveBeenCalledWith(read, 'optional');
    expect(renewMalTokenIfExpiring).not.toHaveBeenCalled();
  });
});

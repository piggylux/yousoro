import type { Cookies } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_LOAD_WAIT_MS } from '#lib/first-load.js';
import { getFollowing } from '#lib/server/anilist-client.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { load } from './+page.server.js';

vi.mock('#lib/server/anilist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/anilist-client.js')>()),
  getFollowing: vi.fn(),
}));
vi.mock('#lib/server/rate-limit.js', () => ({
  takeClientLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));

const FOLLOWING = { user: { id: 1, name: 'Fixture', avatarUrl: null }, following: [], total: 0 };

function load_(isDataRequest = false) {
  return load({
    params: { domain: 'anilist', username: 'Fixture' },
    locals: { session: null, malSession: null, preferences: DEFAULT_PREFERENCES },
    cookies: {} as Cookies,
    getClientAddress: () => '127.0.0.1',
    isDataRequest,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('the friends page', () => {
  it('shows the friends when AniList answers in time', async () => {
    vi.mocked(getFollowing).mockResolvedValue(FOLLOWING);
    expect(await load_()).toMatchObject({ friends: [], total: 0, isOwnPage: false });
  });

  it('answers a first load with the page in outline when AniList is slow', async () => {
    vi.mocked(getFollowing).mockReturnValue(new Promise(() => {}));
    const failed = load_().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS);
    expect(await failed).toMatchObject({ status: 503, body: { loading: true } });
  });

  it('waits for AniList when the browser reads it', async () => {
    let answer: (value: typeof FOLLOWING) => void = () => {};
    vi.mocked(getFollowing).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const pending = load_(true);
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS * 2);
    answer(FOLLOWING);
    expect(await pending).toMatchObject({ total: 0 });
  });
});

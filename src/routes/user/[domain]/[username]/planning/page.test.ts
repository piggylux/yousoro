import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAGE_LOAD_WAIT_MS } from '#lib/first-load.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { load } from './+page.js';

// The first load, on the server
vi.mock('$app/env', () => ({ browser: false }));

const PLANNED = { username: 'Fixture', planned: [] };

function load_(domain: string, malUser: { name: string } | null, fetch: typeof globalThis.fetch) {
  return Promise.resolve(
    load({
      params: { domain, username: 'Fixture' },
      parent: async () => ({ preferences: DEFAULT_PREFERENCES, user: null, malUser }),
      fetch,
    } as unknown as Parameters<typeof load>[0])
  );
}

const never = () => vi.fn(() => new Promise<Response>(() => {}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a first load of a plan list', () => {
  it('shows the list when it arrives in time', async () => {
    const fetch = vi.fn(async () => Response.json(PLANNED));
    expect(await load_('anilist', null, fetch)).toEqual(PLANNED);
  });

  it('answers with the page in outline when the list is slow', async () => {
    const failed = load_('anilist', null, never()).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS);
    expect(await failed).toMatchObject({ status: 503, body: { loading: true } });
  });

  it("waits for the viewer's own MyAnimeList list, as its read may renew their sign-in", async () => {
    let settled = false;
    load_('myanimelist', { name: 'fixture' }, never()).then(
      () => (settled = true),
      () => (settled = true)
    );
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS * 2);
    expect(settled).toBe(false);
  });
});

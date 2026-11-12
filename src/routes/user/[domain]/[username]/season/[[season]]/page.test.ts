import { isHttpError } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { load } from './+page.js';

type Event = Parameters<typeof load>[0];

function event(domain: string, season?: string, malEnabled = true) {
  return {
    params: { domain, username: 'Alice', season },
    parent: async () => ({ malEnabled }),
  } as unknown as Event;
}

async function statusOf(request: Event) {
  try {
    await load(request);
  } catch (err) {
    if (isHttpError(err)) return err.status;
    throw err;
  }
  return 200;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('season page', () => {
  it('opens on the season worth looking at now, asking nothing', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 12), toFake: ['Date'] });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    expect(await load(event('anilist'))).toEqual({
      domain: 'anilist',
      username: 'Alice',
      season: { season: 'FALL', year: 2026 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens on the season its address names', async () => {
    expect(await load(event('myanimelist', 'winter-2027'))).toMatchObject({
      domain: 'myanimelist',
      season: { season: 'WINTER', year: 2027 },
    });
  });

  it("is missing for a season that isn't one, or a service it doesn't know", async () => {
    expect(await statusOf(event('anilist', 'autumn-2026'))).toBe(404);
    expect(await statusOf(event('kitsu'))).toBe(404);
    expect(await statusOf(event('myanimelist', undefined, false))).toBe(404);
  });
});

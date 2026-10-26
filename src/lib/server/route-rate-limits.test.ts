import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

vi.mock('$app/env', () => ({ browser: true, building: false }));

let page: typeof import('../../routes/user/[domain]/[username]/+page.server.js');
let friends: typeof import('../../routes/user/[domain]/[username]/friends/+page.server.js');
let limits: typeof import('./rate-limit.js');
let address: string;
let fixtureNumber = 0;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  address = `fixture-${++fixtureNumber}`;
  page = await import('../../routes/user/[domain]/[username]/+page.server.js');
  friends = await import('../../routes/user/[domain]/[username]/friends/+page.server.js');
  limits = await import('./rate-limit.js');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init!.body as string);
      return Response.json({
        data: query.startsWith('mutation')
          ? { SaveMediaListEntry: { progress: variables.progress, score: 0 } }
          : {
              MediaListCollection: {
                user: { id: 1, name: 'Fixture', avatar: null, mediaListOptions: null },
                lists: [],
              },
            },
      });
    })
  );
});

function event(isDataRequest = false) {
  return {
    params: { domain: 'anilist', username: 'Fixture' },
    locals: {
      session: {
        token: 'fixture.token.signature',
        user: { id: 1, name: 'Fixture', avatarUrl: null },
      },
      preferences: DEFAULT_PREFERENCES,
    },
    cookies: { get: () => undefined },
    isDataRequest,
    getClientAddress: () => address,
    setHeaders: vi.fn(),
    request: new Request('https://yousoro.example/user/anilist/Fixture?/updateEntry', {
      method: 'POST',
      body: new URLSearchParams({ mediaId: '1', progress: '2' }),
    }),
  } as unknown as RequestEvent<{ domain: string; username: string }, '/user/[domain]/[username]'>;
}

describe('route rate limits', () => {
  it('allows six saves and their refreshes within one minute', async () => {
    expect(await page.load(event())).toMatchObject({ canEdit: true });
    for (let i = 0; i < 6; i++) {
      expect(await page.actions.updateEntry!(event())).toMatchObject({ mediaId: 1, progress: 2 });
      expect(await page.load(event(true))).toMatchObject({ canEdit: true });
    }
    expect(fetch).toHaveBeenCalledTimes(13);
  });

  it('returns an action failure with Retry-After when writes are exhausted', async () => {
    await limits.takeClientLimit(address, 'write', 20);
    const request = event();
    const result = await page.actions.updateEntry!(request);
    expect(result).toMatchObject({
      status: 429,
      data: { message: expect.stringContaining('Too many updates') },
    });
    expect(request.locals.retryAfter).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    // Writes do not prevent the current page from refreshing.
    expect(await page.load(event(true))).toMatchObject({ canEdit: true });
  });

  it('keeps existing list data on a rate-limited refresh and still permits a write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await limits.takeClientLimit(address, 'read', 60);
    const request = event(true);
    expect(await page.load(request)).toMatchObject({ unavailable: true, username: 'Fixture' });
    expect(request.locals.retryAfter).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(await page.actions.updateEntry!(event())).toMatchObject({ mediaId: 1, progress: 2 });
  });

  it('throws a framework HTTP error for an exhausted full-page load', async () => {
    await limits.takeClientLimit(address, 'read', 60);
    await expect(page.load(event())).rejects.toMatchObject({ status: 429 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('charges a list two read units and a friends page five', async () => {
    await limits.takeClientLimit(address, 'read', 54);
    expect(await page.load(event())).toMatchObject({ canEdit: true });
    const request = event();
    await expect(friends.load(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('handles a native action and load throttled on the same request without duplicate headers', async () => {
  const request = {
    ...event(),
    setHeaders: vi.fn(() => {
      throw new Error('Rate headers must be emitted by the hook');
    }),
  };
  await limits.takeLimit('anilist', 25, 60, 25);
  const { handle } = await import('../../hooks.server.js');
  // The hook populates locals from cookies; this fixture models the already-authenticated event.
  const response = await handle({
    event: request,
    resolve: async (current) => {
      current.locals.session = {
        token: 'fixture.token.signature',
        user: { id: 1, name: 'Fixture', avatarUrl: null },
      };
      expect(await page.actions.updateEntry!(request)).toMatchObject({ status: 429 });
      await expect(page.load(request)).rejects.toMatchObject({ status: 429 });
      return new Response('framework rate-limit page', { status: 429 });
    },
  });
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBeTruthy();
  expect(request.setHeaders).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves confirmed progress when a save uses the final upstream slot', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('document', { cookie: '' });
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const { query, variables } = JSON.parse(init!.body as string);
    if (query.startsWith('mutation'))
      return Response.json({
        data: { SaveMediaListEntry: { progress: variables.progress, score: 8 } },
      });
    if (query.includes('airingSchedules'))
      return Response.json({ data: { Page: { airingSchedules: [] } } });
    return Response.json({
      data: {
        MediaListCollection: {
          user: { id: 1, name: 'Fixture', avatar: null, mediaListOptions: null },
          lists: [
            {
              isCustomList: false,
              entries: [
                {
                  status: 'CURRENT',
                  progress: 1,
                  score: 0,
                  updatedAt: 0,
                  media: {
                    id: 1,
                    title: { romaji: 'Fixture', english: null },
                    synonyms: [],
                    status: 'FINISHED',
                    episodes: 12,
                    coverImage: { extraLarge: '' },
                    endDate: { year: 2025, month: 1, day: 1 },
                    nextAiringEpisode: null,
                    isAdult: false,
                    meanScore: 80,
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });
  const client = await import('../../routes/user/[domain]/[username]/+page.js');
  const { recordSavedEntry, getRememberedList } = await import('../list-data.js');
  const initial = await page.load(event());
  if (initial.unavailable === true) throw new Error('Expected loaded list');
  const displayed = { ...initial, preferences: DEFAULT_PREFERENCES };
  await limits.takeLimit('anilist', 25, 60, 22);
  const saved = await page.actions.updateEntry!(event());
  expect(saved).toMatchObject({ progress: 2, score: 8 });
  recordSavedEntry(displayed, { ...displayed.watchingList[0], currentEpisode: 2, userScore: 8 });
  const unavailable = await page.load(event(true));
  expect(unavailable).toMatchObject({ unavailable: true });
  const fallback = await client.load({ data: unavailable } as Parameters<typeof client.load>[0]);
  expect(fallback?.watchingList[0]).toMatchObject({ currentEpisode: 2, userScore: 8 });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(displayed.watchingList[0].currentEpisode).toBe(1);
  expect(fallback!.watchingList[0].currentEpisode + 1).toBe(3);
  expect(getRememberedList('Fixture')).not.toHaveProperty('preferences');
  // A full episode count alone does not prove AniList removed it from Watching.
  const retained = recordSavedEntry(
    { ...displayed, watchingList: fallback!.watchingList },
    { ...fallback!.watchingList[0], currentEpisode: 12 },
    'CURRENT'
  );
  expect(retained.watchingList).toHaveLength(1);
  // Completing the anime must also survive a blocked refresh, without restoring its card.
  recordSavedEntry(
    { ...displayed, watchingList: fallback!.watchingList },
    { ...fallback!.watchingList[0], currentEpisode: 12 },
    'COMPLETED'
  );
  const completed = await client.load({ data: unavailable } as Parameters<typeof client.load>[0]);
  expect(completed?.watchingList).toEqual([]);
});

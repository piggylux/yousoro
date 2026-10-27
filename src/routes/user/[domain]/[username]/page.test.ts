import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRememberedList,
  rememberList,
  setListContext,
  getFreshList,
  expireRememberedList,
  recordSavedEntry,
} from '#lib/list-data.js';
import type { Anime } from '#lib/types/anime.js';
import { DEFAULT_PREFERENCES } from '#lib/types/preferences.js';

import { load } from './+page.js';

vi.mock('$app/env', () => ({ browser: true }));

const anime: Anime = {
  id: 1,
  title: 'Fixture',
  englishTitle: null,
  otherTitles: [],
  thumbnailUrl: '',
  status: 'RELEASING',
  isAdult: false,
  meanScore: null,
  userScore: null,
  currentEpisode: 2,
  rewatching: false,
  lastUpdatedAt: null,
  nextEpisode: null,
  recentEpisodeAiredAt: null,
  numberAiredEpisodes: 5,
  endDate: new Date(0),
  numberEpisodes: 12,
};

beforeEach(() => {
  setListContext(999, true);
  setListContext(null, true);
  vi.stubGlobal('document', { cookie: 'hidden-sections=rewatching' });
  rememberList({
    domain: 'anilist',
    username: 'Fixture',
    avatarUrl: null,
    canEdit: true,
    watchingList: [anime, { ...anime, id: 2, isAdult: true }],
    scoreFormat: 'POINT_10',
    hiddenSections: [],
    userProfileLink: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser list reuse', () => {
  const parent = async () => ({
    preferences: { ...DEFAULT_PREFERENCES, showMature: true },
    user: null,
  });
  it('honors Retry-After on HTTP rate limits from the list endpoint', async () => {
    vi.useFakeTimers();
    expireRememberedList('Fixture');
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('Rate limited', { status: 429, headers: { 'Retry-After': '120' } })
      );
    const result = await load({
      data: { deferred: true, username: 'Fixture' },
      parent,
      fetch,
      url: new URL('https://example.com/user/anilist/Fixture'),
    } as unknown as Parameters<typeof load>[0]);
    expect(result?.retryAt).toBe(Date.now() + 120_000);
    expect(result?.watchingList).toHaveLength(2);
    expect(getFreshList('Fixture')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['CURRENT', 'COMPLETED'])(
    'preserves a %s save made while a list read was pending',
    async (status) => {
      const original = getRememberedList('Fixture')!;
      expireRememberedList('Fixture');
      let release!: (response: Response) => void;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          })
      );
      const pending = load({
        data: { deferred: true, username: 'Fixture' },
        parent,
        fetch,
        url: new URL('https://example.com/user/anilist/Fixture'),
      } as unknown as Parameters<typeof load>[0]);
      await Promise.resolve();
      recordSavedEntry(original, { ...anime, currentEpisode: 3, userScore: 9 }, status);
      release(
        Response.json({
          ...original,
          watchingList: original.watchingList.map((entry) => ({
            ...entry,
            recentEpisodeAiredAt: 1234,
          })),
        })
      );
      const result = await pending;
      if (status === 'COMPLETED') {
        expect(result?.watchingList.some((entry: Anime) => entry.id === 1)).toBe(false);
        expect(getFreshList('Fixture')?.watchingList.some((entry) => entry.id === 1)).toBe(false);
      } else {
        expect(result?.watchingList[0]).toMatchObject({
          currentEpisode: 3,
          userScore: 9,
          recentEpisodeAiredAt: 1234,
        });
        expect(getFreshList('Fixture')?.watchingList[0].currentEpisode).toBe(3);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it('updates both mature preference variants without renewing either cache lifetime', async () => {
    vi.useFakeTimers();
    const original = getRememberedList('Fixture')!;
    setListContext(null, false);
    rememberList({ ...original, watchingList: [anime] });
    await vi.advanceTimersByTimeAsync(30_000);
    setListContext(null, true);
    recordSavedEntry(original, { ...anime, currentEpisode: 4 }, 'CURRENT');
    expect(getFreshList('Fixture')?.watchingList[0].currentEpisode).toBe(4);
    setListContext(null, false);
    expect(getFreshList('Fixture')?.watchingList).toHaveLength(1);
    expect(getFreshList('Fixture')?.watchingList[0].currentEpisode).toBe(4);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(getFreshList('Fixture')).toBeNull();
    setListContext(null, true);
    expect(getFreshList('Fixture')).toBeNull();
  });
  it('discards obsolete cache writes even after switching back to the original account', async () => {
    const original = getRememberedList('Fixture')!;
    expireRememberedList('Fixture');
    let release!: (value: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const pending = load({
      data: { deferred: true, username: 'Fixture' },
      parent,
      fetch,
      url: new URL('https://example.com/user/anilist/Fixture'),
    } as unknown as Parameters<typeof load>[0]);
    await Promise.resolve();
    setListContext(10, true);
    setListContext(null, true);
    release(Response.json(original));
    await pending;
    expect(getFreshList('Fixture')).toBeNull();
    expect(getRememberedList('Fixture')).toBeNull();
  });
  it('restores the refresh fallback when returning to a cached list', () => {
    const original = getRememberedList('Fixture')!;
    rememberList({ ...original, username: 'Other' });
    expect(getFreshList('Fixture')).not.toBeNull();
    expect(getRememberedList('Fixture')).toEqual(original);
  });
  it('reuses a fresh navigation read without fetching and preserves the original expiry', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    const result = await load({
      data: { deferred: true, username: 'Fixture' },
      parent,
      fetch,
      url: new URL('https://example.com/user/anilist/Fixture'),
    } as unknown as Parameters<typeof load>[0]);
    expect(result?.watchingList).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    recordSavedEntry(getRememberedList('Fixture')!, { ...anime, currentEpisode: 3 }, 'CURRENT');
    expect(getFreshList('Fixture')?.watchingList[0].currentEpisode).toBe(3);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(getFreshList('Fixture')).toBeNull();
  });
  it('isolates mature preferences, accounts, logout, and explicit refreshes', () => {
    const original = getRememberedList('Fixture')!;
    expect(getFreshList('Fixture')).not.toBeNull();
    setListContext(null, false);
    expect(getFreshList('Fixture')).toBeNull();
    setListContext(null, true);
    expect(getFreshList('Fixture')).not.toBeNull();
    expireRememberedList('Fixture');
    expect(getFreshList('Fixture')).toBeNull();
    rememberList(getRememberedList('Fixture')!);
    setListContext(10, true);
    expect(getRememberedList('Fixture')).toBeNull();
    rememberList(original);
    setListContext(null, true);
    expect(getFreshList('Fixture')).toBeNull();
  });
  it('does not reuse calendar-only data for badge-enriched lists or across airing boundaries', async () => {
    vi.useFakeTimers();
    const original = getRememberedList('Fixture')!;
    rememberList({ ...original, airingsEnriched: false });
    expect(getFreshList('Fixture')).toBeNull();
    expect(getFreshList('Fixture', false)).not.toBeNull();
    rememberList({
      ...original,
      watchingList: [{ ...anime, nextEpisode: { number: 6, airsAt: Date.now() + 5000 } }],
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(getFreshList('Fixture')).toBeNull();
  });
  it('fetches expired data, restores dates, and keeps rate-limit recovery metadata', async () => {
    const original = getRememberedList('Fixture')!;
    expireRememberedList('Fixture');
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(original));
    const event = {
      data: { deferred: true, username: 'Fixture' },
      parent,
      fetch,
      url: new URL('https://example.com/user/anilist/Fixture'),
    };
    const result = await load(event as unknown as Parameters<typeof load>[0]);
    expect(result?.watchingList[0].endDate).toBeInstanceOf(Date);
    expect(fetch).toHaveBeenCalledTimes(1);
    expireRememberedList('Fixture');
    fetch.mockResolvedValueOnce(
      Response.json({
        unavailable: true,
        username: 'Fixture',
        hiddenSections: [],
        retryAt: Date.now() + 60_000,
      })
    );
    const fallback = await load(event as unknown as Parameters<typeof load>[0]);
    expect(fallback?.retryAt).toBeGreaterThan(Date.now());
    expect(fallback?.watchingList).toHaveLength(2);
    expect(getFreshList('Fixture')).toBeNull();
  });
});

describe('unavailable list fallback', () => {
  it.each([
    [false, [1]],
    [true, [1, 2]],
  ] as const)(
    'applies the current show-mature choice %s to the cached list',
    async (showMature, ids) => {
      const result = await load({
        data: { unavailable: true, username: 'Fixture', hiddenSections: [] },
        parent: async () => ({ preferences: { ...DEFAULT_PREFERENCES, showMature }, user: null }),
      } as unknown as Parameters<typeof load>[0]);
      expect(result?.watchingList.map((entry: Anime) => entry.id)).toEqual(ids);
      expect(result?.hiddenSections).toEqual(['rewatching']);
      expect(getRememberedList('Fixture')?.watchingList).toHaveLength(2);
    }
  );
});

import { describe, expect, it } from 'vitest';

import { getBacklog, getNextUp, getWatchState, sortWatchingList } from '#lib/anime.js';
import type { Anime } from '#lib/types/anime.js';

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 1,
    title: 'Anime',
    thumbnailUrl: '',
    status: 'RELEASING',
    currentEpisode: 0,
    lastUpdatedAt: null,
    nextEpisode: null,
    numberAiredEpisodes: null,
    endDate: new Date(0),
    numberEpisodes: 0,
    ...overrides,
  };
}

describe('getWatchState', () => {
  it.each([
    ['to-watch', { currentEpisode: 3, numberAiredEpisodes: 5 }],
    ['caught-up', { currentEpisode: 5, numberAiredEpisodes: 5 }],
    ['completed', { currentEpisode: 12, numberEpisodes: 12, numberAiredEpisodes: 12 }],
    ['next-episode-unscheduled', { status: 'RELEASING' }],
    ['hiatus', { status: 'HIATUS' }],
    ['not-aired', { status: 'NOT_YET_RELEASED' }],
    ['cancelled', { status: 'CANCELLED' }],
    ['unknown', { status: 'FINISHED' }],
  ] as const)('is %s', (state, overrides) => {
    expect(getWatchState(anime(overrides))).toBe(state);
  });

  it('counts a show as completed even when AniList has no aired count', () => {
    expect(
      getWatchState(anime({ currentEpisode: 8, numberEpisodes: 8, status: 'CANCELLED' }))
    ).toBe('completed');
  });

  it('counts a watched count ahead of the aired count as caught up', () => {
    expect(getWatchState(anime({ currentEpisode: 6, numberAiredEpisodes: 5 }))).toBe('caught-up');
  });
});

describe('sortWatchingList', () => {
  it('puts the most recently updated anime to watch first, then caught up, then no episode info', () => {
    const list = [
      anime({ id: 1, status: 'HIATUS', lastUpdatedAt: 900 }),
      anime({ id: 2, currentEpisode: 5, numberAiredEpisodes: 5, lastUpdatedAt: 800 }),
      // A small backlog updated recently beats a big one left alone
      anime({ id: 3, currentEpisode: 1, numberAiredEpisodes: 3, lastUpdatedAt: 300 }),
      anime({ id: 4, status: 'RELEASING' }),
      anime({ id: 5, currentEpisode: 0, numberAiredEpisodes: 100, lastUpdatedAt: 100 }),
      anime({ id: 6, currentEpisode: 12, numberEpisodes: 12, numberAiredEpisodes: 12 }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([3, 5, 2, 6, 1, 4]);
  });

  it('puts anime to watch with no update time after the ones that have one', () => {
    const list = [
      anime({ id: 1, currentEpisode: 0, numberAiredEpisodes: 2 }),
      anime({ id: 2, currentEpisode: 0, numberAiredEpisodes: 2, lastUpdatedAt: 1 }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([2, 1]);
  });

  it('puts caught-up anime with the soonest next episode first, unscheduled ones last', () => {
    const caughtUp = { currentEpisode: 4, numberAiredEpisodes: 4 };
    const list = [
      anime({ id: 1, ...caughtUp }),
      anime({ id: 2, ...caughtUp, nextEpisode: { number: 5, airsAt: 3000 } }),
      anime({ id: 3, ...caughtUp, nextEpisode: { number: 5, airsAt: 1000 } }),
      anime({ id: 4, ...caughtUp }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([3, 2, 1, 4]);
  });

  it('keeps the original order of anime in the same place', () => {
    const list = [
      anime({ id: 1, status: 'CANCELLED' }),
      anime({ id: 2, status: 'RELEASING' }),
      anime({ id: 3, currentEpisode: 0, numberAiredEpisodes: 2 }),
      anime({ id: 4, currentEpisode: 0, numberAiredEpisodes: 2 }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([3, 4, 1, 2]);
  });

  it("doesn't change the list it was given", () => {
    const list = [anime({ id: 1 }), anime({ id: 2, currentEpisode: 0, numberAiredEpisodes: 1 })];
    sortWatchingList(list);
    expect(list.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('getBacklog', () => {
  it('adds up the unwatched aired episodes and counts the anime they come from', () => {
    const list = [
      anime({ id: 1, currentEpisode: 2, numberAiredEpisodes: 5 }),
      anime({ id: 2, currentEpisode: 0, numberAiredEpisodes: 4 }),
      anime({ id: 3, currentEpisode: 5, numberAiredEpisodes: 5 }),
      anime({ id: 4, status: 'RELEASING' }),
    ];

    const backlog = getBacklog(list);
    expect(backlog).toMatchObject({ episodes: 7, anime: 2 });
    expect(backlog.biggest).toMatchObject({ anime: { id: 2 }, episodes: 4 });
  });

  it('picks the first anime listed when two have the biggest backlog', () => {
    const list = [
      anime({ id: 1, currentEpisode: 0, numberAiredEpisodes: 3 }),
      anime({ id: 2, currentEpisode: 0, numberAiredEpisodes: 3 }),
    ];

    expect(getBacklog(list).biggest?.anime.id).toBe(1);
  });

  it('is zero when everything is caught up or has no episode info', () => {
    const list = [
      anime({ currentEpisode: 3, numberAiredEpisodes: 3 }),
      anime({ status: 'HIATUS' }),
    ];

    expect(getBacklog(list)).toEqual({ episodes: 0, anime: 0, biggest: null });
    expect(getBacklog([])).toEqual({ episodes: 0, anime: 0, biggest: null });
  });
});

describe('getNextUp', () => {
  it('finds the soonest scheduled episode across the list', () => {
    const list = [
      anime({ id: 1, nextEpisode: { number: 7, airsAt: 5000 } }),
      anime({ id: 2 }),
      anime({ id: 3, nextEpisode: { number: 2, airsAt: 2000 } }),
    ];

    expect(getNextUp(list)).toMatchObject({ anime: { id: 3 }, episode: 2, airsAt: 2000 });
  });

  it('is null when nothing is scheduled', () => {
    expect(getNextUp([anime({ id: 1 })])).toBeNull();
  });
});

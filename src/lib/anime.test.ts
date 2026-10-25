import { describe, expect, it } from 'vitest';

import {
  getBacklog,
  getNextUp,
  getWatchState,
  hasNewEpisode,
  sortWatchingList,
  withoutHiddenMature,
} from '#lib/anime.js';
import type { Anime } from '#lib/types/anime.js';

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 1,
    title: 'Anime',
    englishTitle: null,
    otherTitles: [],
    thumbnailUrl: '',
    status: 'RELEASING',
    isAdult: false,
    meanScore: null,
    userScore: null,
    currentEpisode: 0,
    rewatching: false,
    lastUpdatedAt: null,
    nextEpisode: null,
    recentEpisodeAiredAt: null,
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

  it('puts rewatches after new episodes, however recently updated, and before caught-up anime', () => {
    const list = [
      anime({ id: 1, currentEpisode: 4, numberAiredEpisodes: 4, lastUpdatedAt: 900 }),
      anime({
        id: 2,
        currentEpisode: 1,
        numberAiredEpisodes: 24,
        rewatching: true,
        lastUpdatedAt: 800,
      }),
      anime({ id: 3, currentEpisode: 1, numberAiredEpisodes: 3, lastUpdatedAt: 100 }),
      anime({
        id: 4,
        currentEpisode: 1,
        numberAiredEpisodes: 12,
        rewatching: true,
        lastUpdatedAt: 850,
      }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([3, 4, 2, 1]);
  });

  it('puts anime whose episode just aired first, newest airing first, then the others', () => {
    const behind = { currentEpisode: 3, numberAiredEpisodes: 4 };
    const list = [
      anime({ id: 1, ...behind, lastUpdatedAt: 900 }),
      anime({ id: 2, ...behind, lastUpdatedAt: 100, recentEpisodeAiredAt: 5000 }),
      anime({ id: 3, ...behind, lastUpdatedAt: 50, recentEpisodeAiredAt: 8000 }),
      // A rewatch's episodes aren't new, even when the show is airing
      anime({ id: 4, ...behind, rewatching: true, lastUpdatedAt: 999, recentEpisodeAiredAt: 9000 }),
    ];

    expect(sortWatchingList(list).map((a) => a.id)).toEqual([3, 2, 1, 4]);
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

  it('leaves rewatches out, since their episodes aren’t new', () => {
    const list = [
      anime({ id: 1, currentEpisode: 2, numberAiredEpisodes: 5 }),
      anime({ id: 2, currentEpisode: 9, numberAiredEpisodes: 276, rewatching: true }),
    ];

    expect(getBacklog(list)).toMatchObject({
      episodes: 3,
      anime: 1,
      biggest: { anime: { id: 1 } },
    });
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

describe('withoutHiddenMature', () => {
  const list = [anime({ id: 1 }), anime({ id: 2, isAdult: true }), anime({ id: 3 })];

  it('lists every anime when mature anime are shown', () => {
    expect(withoutHiddenMature(list, true).map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('leaves out the anime AniList marks as adult when they are hidden', () => {
    expect(withoutHiddenMature(list, false).map((a) => a.id)).toEqual([1, 3]);
  });
});

describe('hasNewEpisode', () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const hours = (n: number) => n * 60 * 60 * 1000;
  // Episode 4 aired `ago` before now, and the user has watched up to episode 3
  const airing = (ago: number, overrides: Partial<Anime> = {}) =>
    anime({
      currentEpisode: 3,
      numberAiredEpisodes: 4,
      recentEpisodeAiredAt: now - ago,
      ...overrides,
    });

  it.each([
    ['an hour ago', hours(1), true],
    ['a day ago', hours(24), true],
    ['exactly 36 hours ago', hours(36), true],
    ['just over 36 hours ago', hours(36) + 1, false],
    ['two days ago', hours(48), false],
  ])('says whether an episode that aired %s is new: %s', (_, ago, expected) => {
    expect(hasNewEpisode(airing(ago), now)).toBe(expected);
  });

  it('ignores an air time after now, from a clock that runs behind', () => {
    expect(hasNewEpisode(airing(-hours(1)), now)).toBe(false);
  });

  it('ignores a new episode the user has already watched', () => {
    expect(hasNewEpisode(airing(hours(1), { currentEpisode: 4 }), now)).toBe(false);
  });

  it('ignores rewatches, whose episodes aren’t new', () => {
    expect(hasNewEpisode(airing(hours(1), { rewatching: true }), now)).toBe(false);
  });

  it('needs to know when the latest episode aired', () => {
    expect(hasNewEpisode(airing(hours(1), { recentEpisodeAiredAt: null }), now)).toBe(false);
  });
});

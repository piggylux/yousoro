import { describe, expect, it } from 'vitest';

import { combinePlannedLists, combineWatchingLists } from '#lib/combined-list.js';
import type { Anime } from '#lib/types/anime.js';
import type { PlannedList } from '#lib/types/api.js';

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 1,
    malId: 101,
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
    numberEpisodes: 12,
    ...overrides,
  };
}

type Planned = PlannedList['planned'][number];

function planned(overrides: Partial<Planned>): Planned {
  return {
    id: 1,
    malId: 101,
    title: 'Anime',
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'FINISHED',
    episodes: 12,
    meanScore: null,
    year: 2020,
    genres: [],
    addedAt: null,
    startedOn: null,
    prequelIds: [],
    allSequels: [],
    ...overrides,
  };
}

describe('combineWatchingLists', () => {
  it('shows an anime on both lists as far along as either has it', () => {
    const [combined] = combineWatchingLists(
      [anime({ currentEpisode: 3, userScore: 85, lastUpdatedAt: 2000 })],
      [anime({ currentEpisode: 5, userScore: 7, lastUpdatedAt: 1000 })],
      'anilist'
    );
    expect(combined).toMatchObject({ currentEpisode: 5, userScore: 85, lastUpdatedAt: 2000 });
    expect(combined.onlyOn).toBeUndefined();
  });

  it("keeps the main list's entry when both are as far along", () => {
    const [combined] = combineWatchingLists(
      [anime({ currentEpisode: 4, rewatching: false })],
      [anime({ currentEpisode: 4, rewatching: true, lastUpdatedAt: 5000 })],
      'myanimelist'
    );
    expect(combined).toMatchObject({ currentEpisode: 4, rewatching: false, lastUpdatedAt: 5000 });
  });

  it("takes a rewatch from the list that's further into it", () => {
    const [combined] = combineWatchingLists(
      [anime({ currentEpisode: 2 })],
      [anime({ currentEpisode: 6, rewatching: true })],
      'anilist'
    );
    expect(combined).toMatchObject({ currentEpisode: 6, rewatching: true });
  });

  it("shows no score when the main list has none, rather than the other's in another format", () => {
    const [combined] = combineWatchingLists(
      [anime({ userScore: null })],
      [anime({ userScore: 8 })],
      'anilist'
    );
    expect(combined.userScore).toBeNull();
  });

  it('marks an anime on one list only with its service, keeping its own score', () => {
    const combined = combineWatchingLists(
      [anime({ id: 1, userScore: 90 })],
      [anime({ id: 2, malId: 202, userScore: 6 })],
      'anilist'
    );
    expect(combined.map(({ id, onlyOn, userScore }) => ({ id, onlyOn, userScore }))).toEqual([
      { id: 1, onlyOn: 'anilist', userScore: 90 },
      { id: 2, onlyOn: 'myanimelist', userScore: 6 },
    ]);
  });
});

describe('combinePlannedLists', () => {
  it("keeps AniList's entry for an anime on both, planned as late as either says", () => {
    const [combined] = combinePlannedLists(
      [planned({ addedAt: 1000, prequelIds: [9] })],
      [planned({ id: null, addedAt: 3000 })]
    );
    expect(combined).toMatchObject({ id: 1, addedAt: 3000, prequelIds: [9] });
    expect(combined.onlyOn).toBeUndefined();
  });

  it('marks anime on one plan list only, leaving those only on MyAnimeList without an AniList id', () => {
    const combined = combinePlannedLists(
      [planned({ id: 1, malId: null }), planned({ id: 2, malId: 102 })],
      [planned({ id: null, malId: 103 })]
    );
    expect(combined.map(({ id, malId, onlyOn }) => ({ id, malId, onlyOn }))).toEqual([
      { id: 1, malId: null, onlyOn: 'anilist' },
      { id: 2, malId: 102, onlyOn: 'anilist' },
      { id: null, malId: 103, onlyOn: 'myanimelist' },
    ]);
  });
});

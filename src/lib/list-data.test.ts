import { beforeEach, describe, expect, it } from 'vitest';

import {
  getRememberedList,
  getSaveRevision,
  reconcileSavedEntries,
  recordSavedEntry,
  rememberList,
  setListContext,
} from '#lib/list-data.js';
import type { Anime } from '#lib/types/anime.js';
import type { AnimePageData } from '#lib/types/api.js';

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

function combinedList(watchingList: Anime[]): Omit<AnimePageData, 'preferences'> {
  return {
    domain: 'anilist',
    username: 'Viewer',
    avatarUrl: null,
    canEdit: true,
    combined: { aniListName: 'Viewer', otherScoreFormat: 'POINT_10' },
    watchingList,
    scoreFormat: 'POINT_100',
    hiddenSections: [],
  };
}

let viewer = 0;
beforeEach(() => setListContext(`viewer-${++viewer}`, true));

describe('a combined list in memory', () => {
  it('keeps what it combines when remembered', () => {
    rememberList(combinedList([]));

    expect(getRememberedList('Viewer')?.combined).toEqual({
      aniListName: 'Viewer',
      otherScoreFormat: 'POINT_10',
    });
  });

  it("doesn't carry a score saved on the other service over to the main list's", () => {
    const onlyOnMal = anime({ onlyOn: 'myanimelist', currentEpisode: 2, userScore: 7 });
    const revision = getSaveRevision();
    recordSavedEntry(combinedList([onlyOnMal]), { ...onlyOnMal, currentEpisode: 3, userScore: 8 });

    // A read that started before the save, by which time the anime is on both lists
    const read = combinedList([anime({ currentEpisode: 2, userScore: 80 })]);
    const [reconciled] = reconcileSavedEntries(read, revision).watchingList;

    expect(reconciled).toMatchObject({ currentEpisode: 3, userScore: 80 });
  });

  it('carries a score saved on the main list over as before', () => {
    const onBoth = anime({ currentEpisode: 2, userScore: 70 });
    const revision = getSaveRevision();
    recordSavedEntry(combinedList([onBoth]), { ...onBoth, userScore: 90 });

    const [reconciled] = reconcileSavedEntries(combinedList([onBoth]), revision).watchingList;

    expect(reconciled.userScore).toBe(90);
  });
});

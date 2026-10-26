import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRememberedList, rememberList } from '#lib/list-data.js';
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

afterEach(() => vi.unstubAllGlobals());

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

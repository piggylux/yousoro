import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describePlanned,
  distinctEnglishTitle,
  getRememberedPlanned,
  markStarted,
  rememberPlanned,
} from '#lib/planning.js';
import type { PlannedAnime } from '#lib/types/anime.js';
import type { PlanningPageData } from '#lib/types/api.js';

function planned(id: number, changes: Partial<PlannedAnime> = {}): PlannedAnime {
  return {
    id,
    malId: id + 1000,
    title: `Anime ${id}`,
    englishTitle: null,
    coverUrl: null,
    isAdult: false,
    status: 'FINISHED',
    episodes: 12,
    meanScore: null,
    ...changes,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('distinctEnglishTitle', () => {
  it.each([
    ['Sousou no Frieren', "Frieren: Beyond Journey's End", "Frieren: Beyond Journey's End"],
    ['GIRLS BAND CRY', 'Girls Band Cry', null],
    ['Uma Musume: Pretty Derby', 'Umamusume: Pretty Derby', null],
    ["BIRDIE WING: Golf Girls' Story", "BIRDIE WING -Golf Girls' Story-", null],
    ['Mushishi', null, null],
  ])('shows "%s" in English as %s', (title, englishTitle, shown) => {
    expect(distinctEnglishTitle(planned(1, { title, englishTitle }))).toBe(shown);
  });
});

describe('describePlanned', () => {
  it.each([
    [{ status: 'FINISHED', episodes: 12 }, '12 episodes'],
    [{ status: 'FINISHED', episodes: 1 }, '1 episode'],
    [{ status: 'FINISHED', episodes: null }, 'Finished'],
    [{ status: 'RELEASING', episodes: 1100 }, 'Airing · 1,100 episodes'],
    [{ status: 'RELEASING', episodes: null }, 'Airing'],
    [{ status: 'HIATUS' }, 'On hiatus'],
    [{ status: 'CANCELLED' }, 'Cancelled'],
  ] as [Partial<PlannedAnime>, string][])('describes %o as "%s"', (changes, text) => {
    expect(describePlanned(planned(1, changes))).toBe(text);
  });
});

describe('remembered plan lists', () => {
  const list = (username: string, ...anime: PlannedAnime[]): PlanningPageData => ({
    domain: 'anilist',
    username,
    canEdit: true,
    planned: anime,
    upcoming: 0,
    userProfileLink: `https://anilist.co/user/${username}/animelist/Planning`,
  });

  it('keeps a list for five minutes, for the same viewer and mature setting only', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const data = list('Fixture', planned(1));
    rememberPlanned('1:', false, 'fixture', data);

    expect(getRememberedPlanned('1:', false, 'anilist', 'FIXTURE')).toBe(data);
    expect(getRememberedPlanned('2:', false, 'anilist', 'fixture')).toBeNull();
    expect(getRememberedPlanned('1:', true, 'anilist', 'fixture')).toBeNull();
    expect(getRememberedPlanned('1:', false, 'myanimelist', 'fixture')).toBeNull();

    vi.mocked(Date.now).mockReturnValue(now + 5 * 60 * 1000);
    expect(getRememberedPlanned('1:', false, 'anilist', 'fixture')).toBeNull();
  });

  it('takes a started anime off that list, whoever remembered it, and no other list', () => {
    rememberPlanned('1:', false, 'Started', list('Started', planned(1), planned(2)));
    rememberPlanned('1:', true, 'Started', list('Started', planned(1), planned(2)));
    rememberPlanned('1:', false, 'Other', list('Other', planned(1)));

    markStarted('anilist', 'started', planned(1));

    for (const showMature of [false, true]) {
      const kept = getRememberedPlanned('1:', showMature, 'anilist', 'Started');
      expect(kept?.planned.map((anime) => anime.id)).toEqual([2]);
    }
    expect(getRememberedPlanned('1:', false, 'anilist', 'Other')?.planned).toHaveLength(1);
  });
});

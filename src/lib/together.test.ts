import { describe, expect, it } from 'vitest';

import { groupNames, MAX_GROUP, pickForGroup, togetherPath } from '#lib/together.js';
import type { ListedAnime, ScoredAnime, TasteProfile } from '#lib/types/match.js';

function listed(id: number, overrides: Partial<ListedAnime> = {}): ListedAnime {
  return {
    id,
    title: `Anime ${id}`,
    coverUrl: null,
    isAdult: false,
    meanScore: null,
    ...overrides,
  };
}

function scored(id: number, score100: number, overrides: Partial<ListedAnime> = {}): ScoredAnime {
  return { ...listed(id, overrides), score: score100 / 10, score100 };
}

function profile(name: string, overrides: Partial<TasteProfile> = {}): TasteProfile {
  return {
    id: name.length * 100 + name.charCodeAt(0),
    name,
    avatarUrl: null,
    scoreFormat: 'POINT_10',
    scored: [],
    seen: [],
    planned: [],
    ...overrides,
  };
}

const ids = (picks: ReturnType<typeof pickForGroup>) => picks.map(({ anime }) => anime.id);

describe('picking an anime for a group', () => {
  it('picks from plan lists, saying who planned each', () => {
    const alice = profile('Alice', { planned: [listed(1), listed(2)] });
    const bob = profile('Bob', { planned: [listed(2)] });
    expect(pickForGroup([alice, bob])).toEqual([
      { anime: listed(2), plannedBy: ['Alice', 'Bob'] },
      { anime: listed(1), plannedBy: ['Alice'] },
    ]);
  });

  it('never picks what anyone has watched, however much they liked it', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 100)],
      planned: [listed(2), listed(3), listed(4)],
    });
    // Bob finished 2, dropped 3 or is watching it, and loved 1, which nobody planned anyway
    const bob = profile('Bob', { scored: [scored(1, 90), scored(2, 20)], seen: [3] });
    expect(ids(pickForGroup([alice, bob]))).toEqual([4]);
  });

  it('puts what most of the group plans to watch first, then AniList’s favorites', () => {
    const alice = profile('Alice', {
      planned: [listed(1, { meanScore: 90 }), listed(2, { meanScore: 60 }), listed(3)],
    });
    const bob = profile('Bob', { planned: [listed(2, { meanScore: 60 }), listed(4)] });
    const carol = profile('Carol', { planned: [listed(2, { meanScore: 60 })] });
    expect(ids(pickForGroup([alice, bob, carol]))).toEqual([2, 1, 3, 4]);
  });

  it('leaves adult anime out unless the viewer chose to see them', () => {
    const alice = profile('Alice', { planned: [listed(1, { isAdult: true })] });
    expect(pickForGroup([alice, profile('Bob')])).toEqual([]);
    expect(ids(pickForGroup([alice, profile('Bob')], { showMature: true }))).toEqual([1]);
  });

  it('shows a dozen picks at most', () => {
    const planned = Array.from({ length: 20 }, (_, id) => listed(id + 1));
    expect(pickForGroup([profile('Alice', { planned }), profile('Bob')])).toHaveLength(12);
  });
});

describe('group paths', () => {
  it('keeps names in order, once each whatever their case, without the host', () => {
    expect(groupNames('Alice', 'Bob/bob/ALICE/Carol')).toEqual(['Bob', 'Carol']);
  });

  it('drops what cannot be a name, and stops at a full group', () => {
    expect(groupNames('Alice', 'Bob/two words//Carol')).toEqual(['Bob', 'Carol']);
    const crowd = Array.from({ length: 10 }, (_, index) => `Friend${index}`);
    expect(groupNames('Alice', crowd.join('/'))).toHaveLength(MAX_GROUP - 1);
  });

  it('builds the path of a group', () => {
    expect(togetherPath('Alice')).toBe('/user/anilist/Alice/together');
    expect(togetherPath('Alice', ['Bob', 'Carol'])).toBe('/user/anilist/Alice/together/Bob/Carol');
  });
});

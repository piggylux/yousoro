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
  it("picks what someone loved that's new to the others, saying who vouches for it", () => {
    const alice = profile('Alice', { scored: [scored(1, 90), scored(2, 40)] });
    const bob = profile('Bob');
    const [pick, ...rest] = pickForGroup([alice, bob]);
    expect(pick).toMatchObject({
      anime: { id: 1 },
      lovedBy: [{ name: 'Alice', score: 9, scoreFormat: 'POINT_10' }],
      plannedBy: [],
      newTo: 1,
    });
    // Below Alice's own average
    expect(rest).toEqual([]);
  });

  it('leaves out what anyone has seen without loving it, or is watching now', () => {
    const alice = profile('Alice', { scored: [scored(1, 90), scored(2, 90), scored(3, 20)] });
    const bob = profile('Bob', { scored: [scored(1, 30), scored(9, 80)], seen: [2] });
    expect(ids(pickForGroup([alice, bob]))).toEqual([9]);
  });

  it("leaves out what everyone loved: it's new to nobody", () => {
    const alice = profile('Alice', { scored: [scored(1, 90), scored(2, 10)] });
    const bob = profile('Bob', { scored: [scored(1, 90), scored(2, 10)] });
    expect(pickForGroup([alice, bob])).toEqual([]);
  });

  it('counts a plan shared by several, but not one person’s plan alone', () => {
    const alice = profile('Alice', { planned: [listed(5), listed(6)] });
    const bob = profile('Bob', { planned: [listed(5)] });
    expect(pickForGroup([alice, bob])).toEqual([
      { anime: listed(5), lovedBy: [], plannedBy: ['Alice', 'Bob'], newTo: 2 },
    ]);
  });

  it('puts what most of the group wants first, then what was loved most', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 100), scored(2, 80), scored(3, 20)],
      planned: [listed(4)],
    });
    const bob = profile('Bob', { scored: [scored(2, 90), scored(4, 95), scored(5, 10)] });
    const carol = profile('Carol', { planned: [listed(2), listed(4)] });
    // 2: loved by two, planned by one; 4: loved by one, planned by two; 1: loved by one
    expect(ids(pickForGroup([alice, bob, carol]))).toEqual([2, 4, 1]);
  });

  it('breaks ties with AniList’s favorite', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 90, { meanScore: 70 }), scored(2, 90, { meanScore: 85 }), scored(3, 10)],
    });
    expect(ids(pickForGroup([alice, profile('Bob')]))).toEqual([2, 1]);
  });

  it('leaves adult anime out unless the viewer chose to see them', () => {
    const alice = profile('Alice', { scored: [scored(1, 90, { isAdult: true }), scored(2, 10)] });
    expect(pickForGroup([alice, profile('Bob')])).toEqual([]);
    expect(ids(pickForGroup([alice, profile('Bob')], { showMature: true }))).toEqual([1]);
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

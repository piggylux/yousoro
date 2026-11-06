import { describe, expect, it } from 'vitest';

import { groupMembers, MAX_GROUP, pickForGroup, togetherPath } from '#lib/together.js';
import type { ListOwner } from '#lib/types/domain.js';
import type { ListedAnime, ScoredAnime, TasteProfile } from '#lib/types/match.js';

// An AniList anime's MyAnimeList id, in these tests
const MAL = 1000;

function listed(id: number, overrides: Partial<ListedAnime> = {}): ListedAnime {
  return {
    id,
    malId: id + MAL,
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
    domain: 'anilist',
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
const onAniList = (name: string): ListOwner => ({ domain: 'anilist', name });
const onMal = (name: string): ListOwner => ({ domain: 'myanimelist', name });

describe('picking an anime for a group', () => {
  it('picks from plan lists, saying who planned each', () => {
    const alice = profile('Alice', { planned: [listed(1), listed(2)] });
    const bob = profile('Bob', { planned: [listed(2)] });
    expect(pickForGroup([alice, bob])).toEqual([
      { anime: listed(2), plannedBy: [onAniList('Alice'), onAniList('Bob')] },
      { anime: listed(1), plannedBy: [onAniList('Alice')] },
    ]);
  });

  it('never picks what anyone has watched, however much they liked it', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 100)],
      planned: [listed(2), listed(3), listed(4)],
    });
    // Bob finished 2, dropped 3 or is watching it, and loved 1, which nobody planned anyway
    const bob = profile('Bob', {
      scored: [scored(1, 90), scored(2, 20)],
      seen: [{ id: 3, malId: 3 + MAL }],
    });
    expect(ids(pickForGroup([alice, bob]))).toEqual([4]);
  });

  it('puts what most of the group plans to watch first, then the best rated', () => {
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

  it('picks for a group on both services by MyAnimeList ids', () => {
    // A MyAnimeList list's anime, which only know their MyAnimeList ids
    const fromMal = (id: number) => listed(0, { id: null, malId: id + MAL });
    const alice = profile('Alice', {
      planned: [listed(1), listed(2), listed(3, { malId: null })],
      seen: [{ id: 4, malId: 4 + MAL }],
    });
    const mika = profile('mika', {
      domain: 'myanimelist',
      id: null,
      planned: [fromMal(1), fromMal(4), fromMal(5)],
      seen: [{ id: null, malId: 2 + MAL }],
    });
    const picks = pickForGroup([alice, mika]);
    // 2 and 4 were seen; 3 isn't on MyAnimeList, so Mika can't have seen it there
    expect(picks.map(({ anime }) => [anime.id, anime.malId])).toEqual([
      [1, 1 + MAL],
      [null, 5 + MAL],
      [3, null],
    ]);
    expect(picks[0].plannedBy).toEqual([onAniList('Alice'), onMal('mika')]);
  });

  it('shows a dozen picks at most', () => {
    const planned = Array.from({ length: 20 }, (_, id) => listed(id + 1));
    expect(pickForGroup([profile('Alice', { planned }), profile('Bob')])).toHaveLength(12);
  });
});

describe('group paths', () => {
  const alice = onAniList('Alice');

  it('keeps people in order, once each whatever their case, without the host', () => {
    expect(groupMembers(alice, 'Bob/bob/ALICE/anilist:Alice/Carol')).toEqual([
      onAniList('Bob'),
      onAniList('Carol'),
    ]);
  });

  it('keeps one name on each service as two people', () => {
    expect(groupMembers(alice, 'myanimelist:Alice/Bob/myanimelist:bob')).toEqual([
      onMal('Alice'),
      onAniList('Bob'),
      onMal('bob'),
    ]);
  });

  it('drops what cannot be a name or a service, and stops at a full group', () => {
    expect(groupMembers(alice, 'Bob/two words//kitsu:Dana/Carol')).toEqual([
      onAniList('Bob'),
      onAniList('Carol'),
    ]);
    const crowd = Array.from({ length: 10 }, (_, index) => `Friend${index}`);
    expect(groupMembers(alice, crowd.join('/'))).toHaveLength(MAX_GROUP - 1);
  });

  it('builds the path of a group, naming the service only for those on the other', () => {
    expect(togetherPath(alice)).toBe('/user/anilist/Alice/together');
    expect(togetherPath(alice, [onAniList('Bob'), onMal('Mika')])).toBe(
      '/user/anilist/Alice/together/Bob/myanimelist:Mika'
    );
    expect(togetherPath(onMal('Mika'), [onMal('Sora')])).toBe(
      '/user/myanimelist/Mika/together/Sora'
    );
  });
});

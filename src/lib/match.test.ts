import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compareTastes,
  favoriteAnime,
  loadTasteProfile,
  matchPath,
  parsePerson,
  parsePersonSegment,
  samePerson,
} from '#lib/match.js';
import type { ScoredAnime, TasteProfile } from '#lib/types/match.js';

// An AniList anime's MyAnimeList id, in these tests
const MAL = 1000;

function scored(id: number, score100: number, overrides: Partial<ScoredAnime> = {}): ScoredAnime {
  return {
    id,
    malId: id + MAL,
    title: `Anime ${id}`,
    coverUrl: null,
    isAdult: false,
    meanScore: null,
    score: score100 / 10,
    score100,
    ...overrides,
  };
}

function profile(name: string, overrides: Partial<TasteProfile> = {}): TasteProfile {
  return {
    domain: 'anilist',
    id: name.length,
    name,
    avatarUrl: null,
    scoreFormat: 'POINT_10',
    scored: [],
    seen: [],
    planned: [],
    ...overrides,
  };
}

// Scores out of 100 for anime 1 to 10, so each list can be rescored for a test
const SCORES = [90, 85, 80, 75, 70, 65, 60, 55, 50, 45];
const scoredAll = (scores: number[]) => scores.map((score, index) => scored(index + 1, score));

describe('comparing tastes', () => {
  it('scores lists that rank the same anime alike highly, and opposite ones low', () => {
    const alice = profile('Alice', { scored: scoredAll(SCORES) });
    const twin = profile('Twin', { scored: scoredAll(SCORES.map((score) => score - 5)) });
    const opposite = profile('Opposite', { scored: scoredAll([...SCORES].reverse()) });

    // Ten anime scored by both pull a perfect correlation half way from 50 to 50 + 93.75
    expect(compareTastes(alice, twin).percent).toBe(97);
    expect(compareTastes(alice, opposite).percent).toBe(0);
    expect(compareTastes(alice, twin).bothScored).toBe(10);
  });

  it('reads scores that correlate as much as two typical anime fans’ do as 50%', () => {
    const alice = profile('Alice', { scored: scoredAll(SCORES) });
    // A correlation of 0.25 with Alice's scores
    const typical = profile('Typical', {
      scored: scoredAll([65, 90, 75, 85, 45, 50, 60, 70, 55, 80]),
    });
    expect(compareTastes(alice, typical).percent).toBe(50);
  });

  it('pulls a match drawn from few anime toward the typical one', () => {
    const alice = profile('Alice', { scored: scoredAll(SCORES) });
    const twin = (count: number) =>
      compareTastes(
        alice,
        profile('Twin', { scored: scoredAll(SCORES.slice(0, count).map((score) => score - 5)) })
      ).percent;
    // Perfect agreement, but over 5 anime rather than 10
    expect(twin(5)).toBe(81);
    expect(twin(10)).toBe(97);
  });

  it('gives no percent until enough anime are scored by both, but still counts what they share', () => {
    const seen = (...ids: number[]) => ids.map((id) => ({ id, malId: id + MAL }));
    const alice = profile('Alice', { scored: scoredAll(SCORES.slice(0, 4)), seen: seen(20, 21) });
    const bob = profile('Bob', { scored: scoredAll(SCORES.slice(0, 4)), seen: seen(20, 30) });
    const match = compareTastes(alice, bob);
    expect(match.percent).toBeNull();
    expect(match.bothScored).toBe(4);
    // Anime 1 to 4, scored by both, and 20, seen by both without a score
    expect(match.inCommon).toBe(5);
  });

  it('counts someone who gave every anime the same score as neither agreeing nor disagreeing', () => {
    const alice = profile('Alice', { scored: scoredAll(SCORES) });
    const flat = profile('Flat', { scored: scoredAll(SCORES.map(() => 70)) });
    expect(compareTastes(alice, flat).percent).toBe(50);
  });

  it('lists the anime both scored above their own averages, the ones both liked most first', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 90), scored(2, 80), scored(3, 40), scored(4, 30)],
    });
    // Bob scores everything lower, but anime 2 and 1 are still above his own average, 2 the most
    const bob = profile('Bob', {
      scored: [scored(1, 65), scored(2, 78), scored(3, 20), scored(4, 50)],
    });
    expect(compareTastes(alice, bob).bothLoved.map(({ anime }) => anime.id)).toEqual([2, 1]);
  });

  it('never lists an anime as both loved and a disagreement', () => {
    // Both above their own averages, but 30 points apart
    const alice = profile('Alice', {
      scored: [scored(1, 100), scored(2, 85), scored(3, 30), scored(4, 30)],
    });
    const bob = profile('Bob', {
      scored: [scored(1, 70), scored(2, 80), scored(3, 20), scored(4, 20)],
    });
    const match = compareTastes(alice, bob);
    expect(match.disagreements.map(({ anime }) => anime.id)).toEqual([1]);
    expect(match.bothLoved.map(({ anime }) => anime.id)).toEqual([2]);
  });

  it('lists disagreements of 30 points or more, the furthest apart first', () => {
    const alice = profile('Alice', {
      scored: [scored(1, 90), scored(2, 80), scored(3, 50)],
    });
    const bob = profile('Bob', { scored: [scored(1, 40), scored(2, 50), scored(3, 70)] });
    const { disagreements } = compareTastes(alice, bob);
    expect(disagreements.map(({ anime, a, b }) => [anime.id, a, b])).toEqual([
      [1, 9, 4],
      [2, 8, 5],
    ]);
  });

  it("picks each one's above-average anime the other hasn't watched, and notes planned ones", () => {
    const alice = profile('Alice', {
      scored: [scored(1, 90), scored(2, 40)],
      seen: [{ id: 10, malId: 10 + MAL }],
      planned: [
        {
          id: 11,
          malId: 11 + MAL,
          title: 'Anime 11',
          coverUrl: null,
          isAdult: false,
          meanScore: 70,
        },
      ],
    });
    const bob = profile('Bob', {
      scored: [
        scored(10, 100),
        scored(11, 90, { meanScore: 70 }),
        scored(12, 90, { meanScore: 80 }),
        scored(13, 20),
        scored(1, 60),
      ],
    });
    const match = compareTastes(alice, bob);
    // 10 is already seen; among equal scores, AniList's favorite first; 13 is below Bob's average
    expect(match.picksForA.map(({ anime, planned }) => [anime.id, planned])).toEqual([
      [12, false],
      [11, true],
    ]);
    expect(match.picksForB.map(({ anime }) => anime.id)).toEqual([]);
  });

  it('leaves adult anime out of what it shows unless asked, without changing the percent', () => {
    const adult = { isAdult: true };
    const alice = profile('Alice', {
      scored: [...scoredAll(SCORES), scored(20, 95, adult)],
    });
    const bob = profile('Bob', {
      scored: [...scoredAll(SCORES), scored(20, 95, adult), scored(21, 99, adult)],
    });
    const hidden = compareTastes(alice, bob);
    const shown = compareTastes(alice, bob, { showMature: true });
    expect(hidden.percent).toBe(shown.percent);
    expect(hidden.bothLoved.some(({ anime }) => anime.isAdult)).toBe(false);
    expect(hidden.picksForA).toEqual([]);
    expect(shown.bothLoved[0].anime.id).toBe(20);
    expect(shown.picksForA.map(({ anime }) => anime.id)).toEqual([21]);
  });

  it('orders favorites by score, then by how users of their service rate them', () => {
    const alice = profile('Alice', {
      scored: [
        scored(1, 80),
        scored(2, 90, { meanScore: 70 }),
        scored(3, 90, { meanScore: 85 }),
        scored(4, 100, { isAdult: true }),
      ],
    });
    expect(favoriteAnime(alice).map(({ id }) => id)).toEqual([3, 2, 1]);
    expect(favoriteAnime(alice, { showMature: true })[0].id).toBe(4);
  });
});

describe('comparing across AniList and MyAnimeList', () => {
  // A MyAnimeList list's anime, which only know their MyAnimeList ids
  const fromMal = (malId: number, score100: number) => scored(0, score100, { id: null, malId });
  const onMal = (name: string, overrides: Partial<TasteProfile> = {}) =>
    profile(name, { domain: 'myanimelist', id: null, ...overrides });

  it('matches anime by their MyAnimeList ids', () => {
    const alice = profile('Alice', { scored: scoredAll(SCORES) });
    const bob = onMal('bob', {
      scored: SCORES.map((score, index) => fromMal(index + 1 + MAL, score - 5)),
    });
    const match = compareTastes(alice, bob);
    expect(match).toMatchObject({ percent: 97, bothScored: 10, inCommon: 10 });
  });

  it("never matches an AniList anime MyAnimeList doesn't have, but can still suggest it", () => {
    const alice = profile('Alice', {
      scored: [...scoredAll(SCORES), scored(50, 100, { malId: null })],
    });
    const bob = onMal('bob', {
      scored: SCORES.map((score, index) => fromMal(index + 1 + MAL, score)),
      seen: [{ id: null, malId: 50 }],
    });
    const match = compareTastes(alice, bob);
    expect(match.bothScored).toBe(10);
    // MyAnimeList's anime 50 is another anime than AniList's 50
    expect(match.picksForB.map(({ anime }) => anime.id)).toEqual([50]);
  });

  it('compares two MyAnimeList lists by their own ids', () => {
    const mika = onMal('mika', { scored: [fromMal(7, 90)], seen: [{ id: null, malId: 8 }] });
    const sora = onMal('sora', { scored: [fromMal(7, 80), fromMal(8, 60)] });
    expect(compareTastes(mika, sora)).toMatchObject({ bothScored: 1, inCommon: 2 });
  });

  it('tells people apart by AniList account, or by MyAnimeList name', () => {
    expect(samePerson(profile('Alice', { id: 1 }), profile('Alicia', { id: 1 }))).toBe(true);
    expect(samePerson(onMal('Mika'), onMal('MIKA'))).toBe(true);
    expect(samePerson(profile('Mika'), onMal('Mika'))).toBe(false);
  });
});

describe('people to compare with', () => {
  it('reads a name, an @name, or a link to an AniList or MyAnimeList profile or list', () => {
    expect(parsePerson('  Alice ', 'anilist')).toEqual({ domain: 'anilist', name: 'Alice' });
    expect(parsePerson('@Alice', 'myanimelist')).toEqual({ domain: 'myanimelist', name: 'Alice' });
    expect(parsePerson('https://anilist.co/user/Alice/', 'myanimelist')).toEqual({
      domain: 'anilist',
      name: 'Alice',
    });
    expect(parsePerson('anilist.co/user/Alice/animelist/Completed', 'anilist')).toEqual({
      domain: 'anilist',
      name: 'Alice',
    });
    expect(parsePerson('https://myanimelist.net/profile/Mika', 'anilist')).toEqual({
      domain: 'myanimelist',
      name: 'Mika',
    });
    expect(parsePerson('myanimelist.net/animelist/Mika?status=2', 'anilist')).toEqual({
      domain: 'myanimelist',
      name: 'Mika',
    });
  });

  it('refuses text that cannot be a name', () => {
    expect(parsePerson('', 'anilist')).toBeNull();
    expect(parsePerson('two words', 'anilist')).toBeNull();
    expect(parsePerson('../settings', 'anilist')).toBeNull();
    expect(parsePerson('https://example.com/user/Alice', 'anilist')).toBeNull();
    expect(parsePerson('kitsu:Alice', 'anilist')).toBeNull();
  });

  it('names the service in a path only for someone on the other one', () => {
    const alice = { domain: 'anilist' as const, name: 'Alice' };
    const mika = { domain: 'myanimelist' as const, name: 'Mika' };
    expect(matchPath(alice)).toBe('/user/anilist/Alice/match');
    expect(matchPath(alice, { domain: 'anilist', name: 'Bob' })).toBe(
      '/user/anilist/Alice/match/Bob'
    );
    expect(matchPath(alice, mika)).toBe('/user/anilist/Alice/match/myanimelist:Mika');
    expect(matchPath(mika, alice)).toBe('/user/myanimelist/Mika/match/anilist:Alice');
    expect(parsePersonSegment('myanimelist:Mika', 'anilist')).toEqual(mika);
    expect(parsePersonSegment('Bob', 'myanimelist')).toEqual({
      domain: 'myanimelist',
      name: 'Bob',
    });
    expect(parsePersonSegment('mal:Mika', 'anilist')).toBeNull();
  });
});

describe('reading a taste profile in the browser', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for the name in lower case, so every spelling shares one cached profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(profile('Alice')));
    expect(await loadTasteProfile({ domain: 'anilist', name: 'ALICE' }, fetcher)).toEqual({
      status: 'ready',
      profile: profile('Alice'),
    });
    expect(fetcher).toHaveBeenCalledWith('/api/taste/anilist/alice?v=3');
  });

  it("keeps a MyAnimeList name as it was asked for, as MyAnimeList doesn't say its spelling", async () => {
    const mal = profile('mika', { domain: 'myanimelist', id: null });
    const fetcher = vi.fn().mockResolvedValue(Response.json(mal));
    expect(await loadTasteProfile({ domain: 'myanimelist', name: 'Mika' }, fetcher)).toEqual({
      status: 'ready',
      profile: { ...mal, name: 'Mika' },
    });
    expect(fetcher).toHaveBeenCalledWith('/api/taste/myanimelist/mika?v=3');
  });

  const someone = { domain: 'anilist' as const, name: 'a' };

  it('tells a missing list, a busy service and a failure apart', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const answer = (response: Response) => vi.fn().mockResolvedValue(response);
    expect(await loadTasteProfile(someone, answer(new Response(null, { status: 404 })))).toEqual({
      status: 'missing',
    });
    const busy = new Response(null, { status: 429, headers: { 'Retry-After': '12' } });
    expect(await loadTasteProfile(someone, answer(busy))).toEqual({
      status: 'busy',
      retryAt: now + 12_000,
    });
    expect(await loadTasteProfile(someone, answer(new Response(null, { status: 502 })))).toEqual({
      status: 'failed',
    });
    expect(await loadTasteProfile(someone, vi.fn().mockRejectedValue(new TypeError()))).toEqual({
      status: 'failed',
    });
  });
});

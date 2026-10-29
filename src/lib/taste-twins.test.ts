import { describe, expect, it, vi } from 'vitest';

import type { TasteProfileState } from '#lib/match.js';
import { compareWithFriends, rankTwins, type TwinResult } from '#lib/taste-twins.js';
import type { ScoredAnime, TasteProfile } from '#lib/types/match.js';

const SCORES = [90, 85, 80, 75, 70, 65, 60, 55, 50, 45];

function profile(id: number, name: string, scores: number[]): TasteProfile {
  return {
    id,
    name,
    avatarUrl: null,
    scoreFormat: 'POINT_100',
    scored: scores.map((score100, index): ScoredAnime => ({
      id: index + 1,
      title: `Anime ${index + 1}`,
      coverUrl: null,
      isAdult: false,
      meanScore: null,
      score: score100,
      score100,
    })),
    seen: [],
    planned: [],
  };
}

const friend = (id: number, name: string) => ({ id, name, avatarUrl: null });
type Loaded = Exclude<TasteProfileState, { status: 'loading' }>;
const loader = (states: Record<string, Loaded>) =>
  vi.fn(async (name: string) => states[name] ?? { status: 'failed' as const });
const ready = (profile: TasteProfile): Loaded => ({ status: 'ready', profile });

describe('comparing tastes with friends', () => {
  it('passes on each friend’s match as it comes, private lists included', async () => {
    const load = loader({
      owner: ready(profile(1, 'Owner', SCORES)),
      twin: ready(profile(2, 'Twin', SCORES)),
      hidden: { status: 'missing' },
    });
    const results: TwinResult[] = [];
    const outcome = await compareWithFriends(
      'owner',
      [friend(2, 'twin'), friend(3, 'hidden')],
      (result) => results.push(result),
      { load }
    );
    expect(outcome).toEqual({ status: 'done' });
    expect(results).toEqual([
      expect.objectContaining({
        id: 2,
        percent: expect.any(Number),
        bothScored: 10,
        private: false,
      }),
      expect.objectContaining({ id: 3, percent: null, private: true }),
    ]);
  });

  it('reads no friend when the owner’s list is private or has too few scores', async () => {
    const hidden = loader({ owner: { status: 'missing' } });
    expect(await compareWithFriends('owner', [friend(2, 'a')], () => {}, { load: hidden })).toEqual(
      { status: 'private' }
    );
    const unscored = loader({ owner: ready(profile(1, 'Owner', [90, 80])) });
    expect(
      await compareWithFriends('owner', [friend(2, 'a')], () => {}, { load: unscored })
    ).toEqual({ status: 'unscored', scored: 2 });
    expect(unscored).toHaveBeenCalledTimes(1);
  });

  it('stops when AniList is busy, keeping the results it had, to resume later', async () => {
    const load = loader({
      owner: ready(profile(1, 'Owner', SCORES)),
      a: ready(profile(2, 'A', SCORES)),
      b: { status: 'busy', retryAt: 5000 },
      c: { status: 'busy', retryAt: 9000 },
      d: ready(profile(5, 'D', SCORES)),
    });
    const results: TwinResult[] = [];
    const outcome = await compareWithFriends(
      'owner',
      ['a', 'b', 'c', 'd'].map((name, index) => friend(index + 2, name)),
      (result) => results.push(result),
      { load, parallel: 3 }
    );
    expect(outcome).toEqual({ status: 'busy', retryAt: 9000 });
    expect(results.map(({ id }) => id)).toEqual([2]);
    expect(load).not.toHaveBeenCalledWith('d');
  });

  it('stops quietly once nobody is waiting', async () => {
    const load = loader({ owner: ready(profile(1, 'Owner', SCORES)) });
    expect(
      await compareWithFriends('owner', [friend(2, 'a')], () => {}, { load, active: () => false })
    ).toBeNull();
  });
});

describe('ranking taste twins', () => {
  const result = (name: string, percent: number | null, bothScored = 10): TwinResult => ({
    id: name.length,
    name,
    avatarUrl: null,
    percent,
    bothScored,
    private: false,
  });

  it('puts the closest first, then the best-founded, leaving out those without a match', () => {
    expect(
      rankTwins([
        result('Far', 30),
        result('Close', 80, 6),
        result('Unknown', null),
        result('Closer', 80, 40),
      ]).map(({ name }) => name)
    ).toEqual(['Closer', 'Close', 'Far']);
  });
});

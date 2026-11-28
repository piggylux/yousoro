import { describe, expect, it } from 'vitest';

import {
  activityReactions,
  describeActivity,
  REUSE_ACTIVITY_FOR_MS,
  reusesActivity,
} from '#lib/activity.js';

const user = { id: 5, name: 'Alice', avatarUrl: null };

describe('describeActivity', () => {
  it.each([
    ['watched episode', '7', 'Alice watched episode 7'],
    ['watched episode', '3 - 5', 'Alice watched episodes 3–5'],
    ['rewatched episode', '10 - 12', 'Alice rewatched episodes 10–12'],
    ['completed', null, 'Alice completed'],
    ['plans to watch', null, 'Alice plans to watch'],
    ['paused watching', null, 'Alice paused watching'],
    ['dropped', null, 'Alice dropped'],
  ])('says %s %s as "%s"', (status, progress, expected) => {
    expect(describeActivity({ user, status, progress })).toBe(expected);
  });

  it('leaves out an old episode count on an update that is not about episodes', () => {
    expect(describeActivity({ user, status: 'plans to watch', progress: '1' })).toBe(
      'Alice plans to watch'
    );
  });

  it('tidies the wording and keeps a count it does not recognise as it is', () => {
    expect(describeActivity({ user, status: ' Watched  Episode ', progress: ' 2.5 ' })).toBe(
      'Alice watched episode 2.5'
    );
  });
});

describe('activityReactions', () => {
  it.each([
    [0, 0, null],
    [1, 0, '1 like'],
    [3, 1, '3 likes · 1 reply'],
    [0, 2, '2 replies'],
  ])('says %i likes and %i replies as %s', (likes, replies, expected) => {
    expect(activityReactions({ likes, replies })).toBe(expected);
  });
});

describe('reusesActivity', () => {
  it('shows what it loaded for a little while, then asks again', () => {
    expect(reusesActivity(1000, 1000 + REUSE_ACTIVITY_FOR_MS - 1)).toBe(true);
    expect(reusesActivity(1000, 1000 + REUSE_ACTIVITY_FOR_MS)).toBe(false);
  });
});

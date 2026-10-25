import { describe, expect, it } from 'vitest';

import { formatAirsIn } from '#lib/countdown.js';

// Local times, so the tests pass in any time zone
const now = new Date(2026, 9, 25, 12, 0).getTime();
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

describe('formatAirsIn', () => {
  it.each([
    ['airing now', at(25, 12)],
    ['airing now', at(25, 11)],
    ['in 1 min', at(25, 12) + 1],
    ['in 45 min', at(25, 12, 45)],
    ['today 18:00', at(25, 18)],
    ['tomorrow', at(26, 1, 30)],
    ['tomorrow', at(26, 18)],
    ['in 2 days', at(27, 9)],
    ['in 13 days', at(25 + 13, 18)],
    ['on 8 Nov', at(25 + 14, 18)],
  ])('says "%s"', (expected, airsAt) => {
    expect(formatAirsIn(airsAt, now, 'en-GB')).toBe(expected);
  });

  it('counts calendar days, so an episode late tonight is still today', () => {
    expect(formatAirsIn(at(25, 23, 30), now, 'en-GB')).toBe('today 23:30');
  });

  it("uses the viewer's own time format", () => {
    expect(formatAirsIn(at(25, 17, 5), now, 'en-US')).toBe('today 5:05 PM');
  });
});

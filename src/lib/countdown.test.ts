import { describe, expect, it } from 'vitest';

import { formatAirsIn, formatTimeAgo } from '#lib/countdown.js';

// Local times, so the tests pass in any time zone
const now = new Date(2026, 9, 25, 12, 0).getTime();
const MINUTES = 60_000;
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

describe('formatTimeAgo', () => {
  it.each([
    ['just now', at(25, 12)],
    ['just now', at(25, 12) + 5000],
    ['just now', at(25, 11, 59) + 1],
    ['1 min ago', at(25, 11, 59)],
    ['45 min ago', at(25, 11, 15)],
    ['1 hour ago', at(25, 11)],
    ['5 hours ago', at(25, 7)],
    ['yesterday', at(24, 9)],
    ['3 days ago', at(22, 18)],
    ['13 days ago', at(12, 18)],
    ['11 Oct', at(11, 18)],
  ])('says "%s"', (expected, when) => {
    expect(formatTimeAgo(when, now, 'en-GB')).toBe(expected);
  });

  it('counts calendar days once a day has passed, so last night is yesterday', () => {
    const earlyMorning = new Date(2026, 9, 25, 1, 0).getTime();
    expect(formatTimeAgo(new Date(2026, 9, 24, 23, 0).getTime(), earlyMorning, 'en-GB')).toBe(
      '2 hours ago'
    );
    expect(formatTimeAgo(new Date(2026, 9, 24, 0, 30).getTime(), earlyMorning, 'en-GB')).toBe(
      'yesterday'
    );
    expect(formatTimeAgo(new Date(2026, 9, 23, 23, 0).getTime(), earlyMorning, 'en-GB')).toBe(
      '2 days ago'
    );
  });

  it('says hours on the day clocks go back, when a day ago is still today', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try {
      // 25 October 2026 has 25 hours in Paris: 00:30 that day was 24 hours before 23:30
      const now = new Date(2026, 9, 25, 23, 30).getTime();
      expect(new Date(now - 24 * 60 * MINUTES).getDate()).toBe(25);
      expect(formatTimeAgo(now - 24 * 60 * MINUTES, now, 'en-GB')).toBe('24 hours ago');
    } finally {
      process.env.TZ = zone;
    }
  });

  it('gives the year for another year', () => {
    expect(formatTimeAgo(new Date(2025, 11, 30, 18).getTime(), now, 'en-GB')).toBe('30 Dec 2025');
  });
});

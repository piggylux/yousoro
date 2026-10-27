import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  advanceCalendarWindow,
  calendarEpisodes,
  calendarWeek,
  sameCalendarDay,
  startOfWeek,
} from './calendar.js';
import type { Anime } from './types/anime.js';

const entry = (id: number, date: Date | null): Anime =>
  ({
    id,
    title: `Anime ${id}`,
    nextEpisode: date ? { airsAt: date.getTime(), number: 3 } : null,
  }) as Anime;

describe('episode calendar', () => {
  it('moves the four-week window forward on Monday while preserving a selected future week', () => {
    const start = new Date(2026, 9, 19);
    expect(advanceCalendarWindow(start, 2, new Date(2026, 9, 26))).toEqual({
      start: new Date(2026, 9, 26),
      weekIndex: 1,
    });
    expect(advanceCalendarWindow(start, 0, new Date(2026, 9, 26))).toEqual({
      start: new Date(2026, 9, 26),
      weekIndex: 0,
    });
    expect(advanceCalendarWindow(start, 3, new Date(2026, 10, 30))).toEqual({
      start: new Date(2026, 10, 30),
      weekIndex: 0,
    });
  });
  it('starts on Monday, including when today is Sunday or crosses a year', () => {
    expect(startOfWeek(new Date(2027, 0, 3, 18))).toEqual(new Date(2026, 11, 28));
    expect(startOfWeek(new Date(2026, 9, 26, 12))).toEqual(new Date(2026, 9, 26));
  });

  it('moves between local calendar days at midnight across month and DST boundaries', () => {
    expect(addCalendarDays(new Date(2026, 2, 28, 18), 2)).toEqual(new Date(2026, 2, 30));
    expect(addCalendarDays(new Date(2026, 9, 24), 2)).toEqual(new Date(2026, 9, 26));
    expect(addCalendarDays(new Date(2026, 11, 31), 1)).toEqual(new Date(2027, 0, 1));
  });

  it('compares full local dates instead of just the day number', () => {
    expect(sameCalendarDay(new Date(2026, 9, 27, 2), new Date(2026, 9, 27, 23))).toBe(true);
    expect(sameCalendarDay(new Date(2026, 9, 27), new Date(2026, 10, 27))).toBe(false);
  });

  it('groups future airings by local date, excludes past and unscheduled episodes, and sorts by time', () => {
    const start = new Date(2026, 9, 26);
    const now = new Date(2026, 9, 26, 12).getTime();
    const anime = [
      entry(1, new Date(2026, 9, 27, 22)),
      entry(2, new Date(2026, 9, 27, 9)),
      entry(3, new Date(2026, 9, 26, 11)),
      entry(4, null),
      entry(5, new Date(2026, 10, 2)),
      entry(6, new Date(2026, 9, 26, 12)),
    ];
    const week = calendarWeek(calendarEpisodes(anime, null, now), start, now);
    expect(week).toHaveLength(7);
    expect(week[1].episodes.map((a) => a.anime.id)).toEqual([2, 1]);
    expect(week.flatMap((day) => day.episodes)).toHaveLength(2);
    expect(anime[0].id).toBe(1);
  });

  it('includes midnight at the start and excludes midnight after the final day', () => {
    const start = new Date(2026, 9, 26);
    const week = calendarWeek(
      calendarEpisodes(
        [entry(1, start), entry(2, new Date(2026, 10, 1, 23, 59)), entry(3, new Date(2026, 10, 2))],
        null,
        start.getTime() - 1
      ),
      start,
      start.getTime() - 1
    );
    expect(week[0].episodes.map((a) => a.anime.id)).toEqual([1]);
    expect(week[6].episodes.map((a) => a.anime.id)).toEqual([2]);
    expect(week.flatMap((day) => day.episodes)).toHaveLength(2);
  });

  it('includes multiple confirmed episodes per anime, and filters unknown/hidden anime and past airings', () => {
    const anime = [entry(1, new Date(2026, 9, 27))];
    const episodes = calendarEpisodes(
      anime,
      [
        { mediaId: 1, episode: 3, airsAt: 100 },
        { mediaId: 1, episode: 4, airsAt: 200 },
        { mediaId: 1, episode: 4, airsAt: 210 },
        { mediaId: 1, episode: 2, airsAt: 10 },
        { mediaId: 2, episode: 3, airsAt: 100 },
      ],
      50
    );
    expect(episodes.map((episode) => [episode.anime.id, episode.episode, episode.airsAt])).toEqual([
      [1, 3, 100],
      [1, 4, 210],
    ]);
  });

  it('only falls back to next known episodes while the schedule is missing or partial', () => {
    const anime = [entry(1, new Date(1000)), entry(2, new Date(2000))];
    expect(calendarEpisodes(anime, [], 0)).toEqual([]);
    expect(calendarEpisodes(anime, null, 0)).toHaveLength(2);
    const episodes = calendarEpisodes(anime, [{ mediaId: 1, episode: 3, airsAt: 1500 }], 0, true);
    expect(episodes.map((episode) => episode.airsAt)).toEqual([1500, 2000]);
  });
  it('prefers a current next-episode time over a saved stale airing', () => {
    const anime = [entry(1, new Date(2000))];
    expect(
      calendarEpisodes(anime, [{ mediaId: 1, episode: 3, airsAt: 1000 }], 0, true, true)[0].airsAt
    ).toBe(2000);
  });
});

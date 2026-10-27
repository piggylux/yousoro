import type { Anime } from '#lib/types/anime.js';
import type { ScheduledEpisode } from '#lib/types/schedule.js';

export type CalendarEpisode = { anime: Anime; episode: number; airsAt: number };

export function calendarEpisodes(
  anime: Anime[],
  schedules: ScheduledEpisode[] | null,
  now: number,
  includeNext = false,
  preferNext = false
): CalendarEpisode[] {
  const byId = new Map(anime.map((entry) => [entry.id, entry]));
  const episodes = new Map<string, CalendarEpisode>();
  if (schedules === null || includeNext) {
    for (const entry of anime) {
      if (entry.nextEpisode && entry.nextEpisode.airsAt > now)
        episodes.set(`${entry.id}:${entry.nextEpisode.number}`, {
          anime: entry,
          episode: entry.nextEpisode.number,
          airsAt: entry.nextEpisode.airsAt,
        });
    }
  }
  for (const schedule of schedules ?? []) {
    if (preferNext && episodes.has(`${schedule.mediaId}:${schedule.episode}`)) continue;
    const entry = byId.get(schedule.mediaId);
    if (entry && schedule.airsAt > now)
      episodes.set(`${entry.id}:${schedule.episode}`, {
        anime: entry,
        episode: schedule.episode,
        airsAt: schedule.airsAt,
      });
  }
  return [...episodes.values()].sort(
    (a, b) =>
      a.airsAt - b.airsAt || a.anime.title.localeCompare(b.anime.title) || a.episode - b.episode
  );
}

/** Local calendar arithmetic preserves midnight across daylight-saving changes. */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfWeek(date: Date): Date {
  return addCalendarDays(date, -((date.getDay() + 6) % 7));
}

/** Keep a selected week visible across Monday rollover when it is still in the new window. */
export function advanceCalendarWindow(start: Date, weekIndex: number, now: Date) {
  const nextStart = startOfWeek(now);
  const selected = addCalendarDays(start, weekIndex * 7);
  const nextIndex = Array.from({ length: 4 }, (_, index) => index).find((index) =>
    sameCalendarDay(selected, addCalendarDays(nextStart, index * 7))
  );
  return { start: nextStart, weekIndex: nextIndex ?? 0 };
}

export function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function calendarWeek(episodes: CalendarEpisode[], start: Date, now: number) {
  const upcoming = episodes.filter((entry) => entry.airsAt > now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addCalendarDays(start, i);
    const end = addCalendarDays(date, 1).getTime();
    return {
      date,
      episodes: upcoming
        .filter((entry) => entry.airsAt >= date.getTime() && entry.airsAt < end)
        .sort((a, b) => a.airsAt - b.airsAt || a.anime.title.localeCompare(b.anime.title)),
    };
  });
}

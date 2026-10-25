const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * A short phrase for when an episode airs, from `now`, in the viewer's own time zone: "in 45 min",
 * "today 18:00", "tomorrow", "in 3 days", then "on 8 Nov" two weeks or more ahead. Short enough for
 * a badge on the narrowest card, so only today's episodes get a time; `formatAirDate` has the rest.
 */
export function formatAirsIn(airsAt: number, now: number, locale?: string): string {
  const diff = airsAt - now;
  if (diff <= 0) return 'airing now';

  const minutes = Math.ceil(diff / MINUTE);
  if (minutes < 60) return `in ${minutes} min`;

  // Calendar days rather than 24h blocks, so tonight is "today" and tomorrow morning "tomorrow"
  const days = Math.round((startOfDay(airsAt) - startOfDay(now)) / DAY);
  if (days === 0) {
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    return `today ${time.format(airsAt)}`;
  }
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return `on ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(airsAt)}`;
}

/** The full air date and time, e.g. for a tooltip: "Tue 28 Oct, 18:00" */
export function formatAirDate(airsAt: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(airsAt);
}

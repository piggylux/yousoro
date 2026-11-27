const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** How many calendar days before `now` a time was, in the viewer's own time zone: 0 for today */
export function daysAgo(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY);
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

/**
 * How long ago something happened, from `now`, in the viewer's own time zone: "just now",
 * "5 min ago", "3 hours ago", "yesterday", "4 days ago", then the date, "8 Nov", two weeks or more
 * back, with the year when it was another year. `formatAirDate` gives the full date and time
 */
export function formatTimeAgo(at: number, now: number, locale?: string): string {
  const diff = now - at;
  if (diff < MINUTE) return 'just now';

  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  // Calendar days, as for airings, so last night is "yesterday". On the day clocks go back, a day has
  // 25 hours, so something a day ago can still be today
  const days = daysAgo(at, now);
  if (hours < 24 || days <= 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
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

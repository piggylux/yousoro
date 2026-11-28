import { error } from '@sveltejs/kit';

/**
 * How long a page's first load waits for what it shows. Past this it answers without it, with the
 * page in outline, rather than leave the visitor a blank tab for as long as AniList or MyAnimeList
 * takes; the browser then reads it, as moving between pages does (see PageError.svelte). Reads
 * usually finish well within it
 */
export const PAGE_LOAD_WAIT_MS = 2500;

export const STILL_READING = Symbol('still reading');

/**
 * The read's result, or STILL_READING once `ms` have passed. The read carries on, and the race
 * handles its rejection, so a read that fails after the page answered goes unnoticed
 */
export async function within<T>(
  read: Promise<T>,
  ms = PAGE_LOAD_WAIT_MS
): Promise<T | typeof STILL_READING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<typeof STILL_READING>((resolve) => {
    timer = setTimeout(() => resolve(STILL_READING), ms);
  });
  try {
    return await Promise.race([read, wait]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answers a first load that's still reading, so the visitor sees the page is on its way. A 503
 * keeps crawlers from taking it for the page itself
 */
export function stillReading(service: string, what: string): never {
  error(
    503,
    `${service} is taking longer than usual to answer. ${what} will appear as soon as it does.`,
    { loading: true }
  );
}

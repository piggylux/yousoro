import { error, type RequestEvent } from '@sveltejs/kit';

import {
  namesEpisode,
  nyaaQueryPlan,
  packIncludes,
  nyaaQueryLength,
  nyaaSearchUrl,
  NYAA_MAX_QUERY_LENGTH,
  NYAA_SEARCH_TIMEOUT_MS,
  NYAA_ATTEMPT_TIMEOUT_MS,
  NYAA_SERIES_LOOKUP_MS,
  type NyaaSearch,
  type NyaaSeries,
} from '#lib/nyaa.js';
import { getSeries } from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDownloadLanguage, isDownloadVersion } from '#lib/types/preferences.js';

export async function POST(event: RequestEvent) {
  const body = await event.request.json().catch(() => null);
  const title = (value: unknown) => typeof value === 'string' && value.length <= 500;
  if (
    !body ||
    !title(body.title) ||
    !body.title.trim() ||
    (body.query !== undefined && (!title(body.query) || !body.query.trim())) ||
    (body.englishTitle != null && !title(body.englishTitle)) ||
    (body.otherTitles !== undefined &&
      (!Array.isArray(body.otherTitles) ||
        body.otherTitles.length > 100 ||
        !body.otherTitles.every(title))) ||
    !Number.isSafeInteger(body.episode) ||
    body.episode < 1 ||
    body.episode > 100000 ||
    (body.language !== undefined && !isDownloadLanguage(body.language)) ||
    (body.version !== undefined && !isDownloadVersion(body.version)) ||
    (body.adult !== undefined && typeof body.adult !== 'boolean') ||
    (body.mediaId !== undefined && (!Number.isSafeInteger(body.mediaId) || body.mediaId < 1))
  )
    error(400, 'Provide an anime title, episode and valid search preferences');

  const search = body as NyaaSearch;
  let plan = nyaaQueryPlan(search);
  if (nyaaQueryLength(plan.query) > NYAA_MAX_QUERY_LENGTH)
    error(400, 'Search query is too long. Use fewer title words or alternatives.');

  // Every request to nyaa.si counts against the client limit, as it's made, so a search that finds
  // releases at once costs one read. A later try only goes ahead while the client has reads left.
  const address = event.getClientAddress();
  const limit = await takeClientLimit(address, 'read');
  if (!limit.allowed) {
    event.locals.retryAfter = limit.retryAfter;
    error(429, 'Too many searches. Please wait before trying again.');
  }
  const another = async () => (await takeClientLimit(address, 'read')).allowed;

  const deadline = Date.now() + NYAA_SEARCH_TIMEOUT_MS;
  if (search.mediaId !== undefined && search.query === undefined) {
    const series = await lookUpSeries(search.mediaId);
    if (series) plan = nyaaQueryPlan(search, series);
  }
  const attempt = async (query: string) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new DOMException('Search timed out', 'TimeoutError');
    // Build the destination ourselves so this endpoint can only read the two Nyaa feeds.
    const url = new URL(nyaaSearchUrl({ ...search, query }));
    url.searchParams.set('page', 'rss');
    return fetchFeed(event, url, Math.min(NYAA_ATTEMPT_TIMEOUT_MS, remaining));
  };
  try {
    let query = plan.query;
    let feed: Uint8Array<ArrayBuffer>;
    try {
      feed = await attempt(query);
    } catch (cause) {
      // nyaa.si answers fewer phrases faster, so the most likely ones alone can still arrive in
      // time. Do not retry upstream failures or rate limits, and never a disconnected browser.
      if (!plan.lighter || event.request.signal.aborted || !isTimeout(cause) || !(await another()))
        throw cause;
      query = plan.lighter;
      feed = await attempt(query);
      // The phrases left out may have matched, so this isn't a search with no results
      if (isEmptyFeed(feed)) throw cause;
    }
    let empty = isEmptyFeed(feed);
    // nyaa.si answers words in a tenth of a second and phrases in about a quarter each, so the
    // series' word search goes before the broader phrases, which it spares when it finds releases.
    // When it fails, the phrases still answer
    if (query === plan.query && plan.wide && empty && (await another())) {
      try {
        const { episode } = plan.wide;
        const wide = keepReleases(await attempt(plan.wide.query), (name) =>
          namesEpisode(name, episode)
        );
        if (!isEmptyFeed(wide)) {
          feed = wide;
          query = plan.wide.query;
          empty = false;
        }
      } catch (cause) {
        if (event.request.signal.aborted) throw cause;
      }
    }
    if (query === plan.query && plan.broader && empty && (await another())) {
      query = plan.broader;
      feed = await attempt(query);
      empty = isEmptyFeed(feed);
    }
    // No release names the episode alone, as with an older series released in packs. Also a last
    // try, so when it fails, the searches before still answer
    let inPacks = false;
    if (plan.packs && query !== plan.lighter && empty && (await another())) {
      try {
        const packs = plan.packs;
        const found = keepReleases(await attempt(packs.query), (name) => packIncludes(name, packs));
        if (!isEmptyFeed(found)) {
          feed = found;
          query = packs.query;
          inPacks = true;
        }
      } catch (cause) {
        if (event.request.signal.aborted) throw cause;
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/xml; charset=utf-8',
      'X-Nyaa-Query': encodeURIComponent(query),
    };
    if (inPacks) headers['X-Nyaa-Packs'] = '1';
    return new Response(feed, { headers });
  } catch (cause) {
    if (event.request.signal.aborted) error(499, 'Search cancelled');
    if (isTimeout(cause))
      error(504, 'Nyaa search timed out. Try a shorter query or open the search on Nyaa.');
    error(502, 'Nyaa results are unavailable. Try again or open the search on Nyaa.');
  }
}

// Without the series' other entries when AniList can't say in time, or at all
function lookUpSeries(mediaId: number): Promise<NyaaSeries | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    getSeries(mediaId).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), NYAA_SERIES_LOOKUP_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Only the releases whose names `keep` accepts. Entities go first, so "&#39;" isn't episode 39
function keepReleases(feed: Uint8Array, keep: (name: string) => boolean): Uint8Array<ArrayBuffer> {
  const xml = new TextDecoder().decode(feed).replace(/<item>[\s\S]*?<\/item>\s*/g, (item) => {
    const title = /<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? '';
    return keep(title.replace(/&#?\w+;/g, ' ')) ? item : '';
  });
  return new TextEncoder().encode(xml);
}

const isTimeout = (cause: unknown) =>
  cause instanceof DOMException && cause.name === 'TimeoutError';

function isEmptyFeed(feed: Uint8Array) {
  const xml = new TextDecoder().decode(feed);
  return (
    /<rss[\s>]/i.test(xml) &&
    /<channel[\s>]/i.test(xml) &&
    /<\/channel\s*>/i.test(xml) &&
    !/<item[\s>]/i.test(xml)
  );
}

async function fetchFeed(
  event: RequestEvent,
  url: URL,
  timeout: number
): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Search timed out', 'TimeoutError')),
    timeout
  );
  const signal = AbortSignal.any([event.request.signal, controller.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    void reader?.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const response = await event.fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`Nyaa returned ${response.status}`);
    }
    // Bound the response before sending it to the browser's native XML parser.
    reader = response.body?.getReader();
    if (!reader) throw new Error('Missing feed');
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error('Feed too large');
      chunks.push(value);
    }
    signal.throwIfAborted();
    const feed = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      feed.set(chunk, offset);
      offset += chunk.length;
    }
    return feed;
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    throw cause;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

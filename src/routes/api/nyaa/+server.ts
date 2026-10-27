import { error, type RequestEvent } from '@sveltejs/kit';

import { nyaaSearchUrl, type NyaaSearch } from '#lib/nyaa.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { isDownloadLanguage, isDownloadVersion } from '#lib/types/preferences.js';

export async function POST(event: RequestEvent) {
  const body = await event.request.json().catch(() => null);
  const title = (value: unknown) => typeof value === 'string' && value.length <= 500;
  if (
    !body ||
    !title(body.title) ||
    !body.title.trim() ||
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
    (body.adult !== undefined && typeof body.adult !== 'boolean')
  )
    error(400, 'Provide an anime title, episode and valid search preferences');

  const limit = await takeClientLimit(event.getClientAddress(), 'read');
  if (!limit.allowed) {
    event.locals.retryAfter = limit.retryAfter;
    error(429, 'Too many searches. Please wait before trying again.');
  }

  // Build the destination ourselves so this endpoint can only read the two Nyaa feeds.
  const url = new URL(nyaaSearchUrl(body as NyaaSearch));
  url.searchParams.set('page', 'rss');
  try {
    const response = await event.fetch(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Nyaa returned ${response.status}`);
    // Bound the response before sending it to the browser's native XML parser.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing feed');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw new Error('Feed too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const feed = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      feed.set(chunk, offset);
      offset += chunk.length;
    }
    return new Response(feed, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  } catch {
    error(502, 'Nyaa results are unavailable. Try again or open the search on Nyaa.');
  }
}

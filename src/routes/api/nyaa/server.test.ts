import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  nyaaQueryPlan,
  nyaaSearchUrl,
  NYAA_SERIES_LOOKUP_MS,
  NYAA_ATTEMPT_TIMEOUT_MS,
  NYAA_SEARCH_TIMEOUT_MS,
} from '#lib/nyaa.js';
import { getSeries } from '#lib/server/anilist-client.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { POST } from './+server.js';

vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
vi.mock('#lib/server/anilist-client.js', () => ({ getSeries: vi.fn() }));
const feed = '<rss version="2.0"><channel><item><title>Show - 01</title></item></channel></rss>';
const emptyFeed = '<rss version="2.0"><channel><title>Nyaa</title></channel></rss>';
function event(body: unknown = { title: 'Show', episode: 1 }, signal?: AbortSignal) {
  return {
    locals: {},
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn().mockResolvedValue(new Response(feed)),
    request: new Request('https://example.test/api/nyaa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  } as unknown as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
  vi.mocked(getSeries).mockResolvedValue({ arc: null, related: [] });
});
afterEach(() => vi.useRealTimers());

describe('Nyaa results endpoint', () => {
  it.each([false, true])(
    'preserves the episode search and chooses the correct feed (adult: %s)',
    async (adult) => {
      const search = {
        title: 'Show',
        englishTitle: 'Other Show',
        otherTitles: ['Another Name'],
        episode: 5,
        language: 'french',
        version: 'subbed',
        adult,
      } as const;
      const request = event(search);
      const response = await POST(request);
      expect(await response.text()).toBe(feed);
      expect(response.headers.get('Content-Type')).toContain('application/xml');
      const [url, options] = vi.mocked(request.fetch).mock.calls[0];
      const expected = new URL(nyaaSearchUrl({ ...search, otherTitles: [...search.otherTitles] }));
      expected.searchParams.set('page', 'rss');
      expect(String(url)).toBe(expected.href);
      expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
    }
  );

  it.each([
    null,
    {},
    { title: '', episode: 1 },
    { title: 'Show', episode: 0 },
    { title: 'Show', episode: 1.5 },
    { title: 'Show', episode: 1, adult: 'false' },
    { title: 'Show', episode: 1, otherTitles: 'bad' },
    { title: 'Show', episode: 1, otherTitles: [null] },
    { title: 'Show', episode: 1, language: 'invalid' },
    { title: 'Show', episode: 1, version: 'invalid' },
    { title: 'Show', episode: 1, query: '' },
    { title: 'Show', episode: 1, query: '   ' },
    { title: 'Show', episode: 1, query: 123 },
    { title: 'Show', episode: 1, query: null },
    { title: 'Show', episode: 1, query: 'x'.repeat(501) },
    { title: 'Show', episode: 1, mediaId: 0 },
    { title: 'Show', episode: 1, mediaId: '185874' },
  ])('rejects malformed searches before fetching: %j', async (body) => {
    const request = event(body);
    await expect(POST(request)).rejects.toMatchObject({ status: 400 });
    expect(request.fetch).not.toHaveBeenCalled();
  });

  it('never uses a caller-provided upstream URL', async () => {
    const request = event({ title: 'Show', episode: 1, url: 'http://localhost/private' });
    await POST(request);
    expect(String(vi.mocked(request.fetch).mock.calls[0][0])).toMatch(/^https:\/\/nyaa\.si\//);
  });

  it.each([false, true])(
    'fetches the exact custom query on the expected site (adult: %s)',
    async (adult) => {
      const query = '  "Different Show" 12 1080p -batch | Other  ';
      const request = event({
        title: 'Show',
        episode: 1,
        adult,
        language: 'french',
        version: 'dubbed',
        query,
      });
      await POST(request);
      const url = new URL(String(vi.mocked(request.fetch).mock.calls[0][0]));
      expect(url.hostname).toBe(adult ? 'sukebei.nyaa.si' : 'nyaa.si');
      expect(url.searchParams.get('q')).toBe(query.trim());
      expect(url.searchParams.get('c')).toBe(adult ? '1_1' : '1_3');
      expect(url.searchParams.get('page')).toBe('rss');
    }
  );

  it('honors client cooldown without fetching', async () => {
    vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
    const request = event();
    await expect(POST(request)).rejects.toMatchObject({ status: 429 });
    expect(request.locals.retryAfter).toBe(20);
    expect(request.fetch).not.toHaveBeenCalled();
  });

  it.each(['offline', 'upstream error', 'oversized feed'])(
    'returns a recoverable failure for %s',
    async (failure) => {
      const request = event();
      const fetch = vi.mocked(request.fetch);
      if (failure === 'offline') fetch.mockRejectedValue(new Error('offline'));
      else
        fetch.mockImplementation(async () =>
          failure === 'upstream error'
            ? new Response('blocked', { status: 503 })
            : new Response('x'.repeat(2_000_001))
        );
      await expect(POST(request)).rejects.toMatchObject({ status: 502 });
    }
  );

  const queriesOf = (request: RequestEvent) =>
    vi.mocked(request.fetch).mock.calls.map(([url]) => new URL(String(url)).searchParams.get('q'));
  // Answers each search by its query, as they run together
  const answer = (
    request: RequestEvent,
    byQuery: (query: string, options?: RequestInit) => Promise<Response>
  ) =>
    vi
      .mocked(request.fetch)
      .mockImplementation((url, options) =>
        byQuery(new URL(String(url)).searchParams.get('q')!, options)
      );
  const release = (id: number, title: string, date: string) =>
    `<item><title>${title}</title><guid isPermaLink="true">https://nyaa.si/view/${id}</guid><pubDate>${date}</pubDate></item>`;
  const feedOf = (...items: string[]) =>
    `<rss version="2.0"><channel><title>Nyaa</title>${items.join('')}</channel></rss>`;

  it("merges every search's releases, once each, newest first", async () => {
    const search = { title: 'Main Title', otherTitles: ['Other Title'], episode: 5 };
    const plan = nyaaQueryPlan(search);
    const older = release(1, 'Main Title - 05 [720p]', 'Mon, 01 Jan 2024 00:00:00 -0000');
    const shared = release(2, 'Main Title S01E05 1080p', 'Tue, 02 Jan 2024 00:00:00 -0000');
    const newest = release(3, 'Main Title 05 [1080p]', 'Thu, 04 Jan 2024 00:00:00 -0000');
    const named = release(4, 'Main Title - S01E05 WEB', 'Wed, 03 Jan 2024 00:00:00 -0000');
    // A word search finds this one only through its checksum
    const loose = release(5, 'Main Title - 15 [05ABCDEF]', 'Fri, 05 Jan 2024 00:00:00 -0000');
    const request = event(search);
    answer(request, async (query) =>
      query === plan.query
        ? new Response(feedOf(older, shared))
        : query === plan.broader
          ? new Response(feedOf(newest, shared))
          : new Response(feedOf(named, loose))
    );
    const response = await POST(request);
    expect(await response.text()).toBe(
      feedOf(newest, named, shared, older).replace(/<\/item>(?=<item>)/g, '</item>\n')
    );
    expect(queriesOf(request)).toEqual([plan.query, plan.broader, plan.words!.query]);
    expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(plan.query);
    // One read for each request to nyaa.si, as it's made
    expect(takeClientLimit).toHaveBeenCalledTimes(3);
  });

  it('opens the full search that found the most releases', async () => {
    const search = { title: 'Main Title', episode: 5 };
    const plan = nyaaQueryPlan(search);
    const date = 'Mon, 01 Jan 2024 00:00:00 -0000';
    const request = event(search);
    answer(
      request,
      async (query) =>
        new Response(
          query === plan.words!.query
            ? feedOf(
                release(1, 'Main.Title.S01E05.1080p', date),
                release(2, 'Main Title - 05', date)
              )
            : emptyFeed
        )
    );
    const response = await POST(request);
    expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(plan.words!.query);
  });

  it('stops trying once the client has no reads left', async () => {
    vi.mocked(takeClientLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfter: 60 })
      .mockResolvedValue({ allowed: false, retryAfter: 60 });
    const request = event();
    vi.mocked(request.fetch).mockImplementation(async () => new Response(emptyFeed));
    expect(await (await POST(request)).text()).toBe(emptyFeed);
    expect(request.fetch).toHaveBeenCalledOnce();
  });

  it('returns empty results once every search and the packs found nothing', async () => {
    const search = { title: 'Show', episode: 1 };
    const { query, broader, words, packs } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockImplementation(async () => new Response(emptyFeed));
    expect(await (await POST(request)).text()).toBe(emptyFeed);
    expect(queriesOf(request)).toEqual([query, broader, words!.query, packs!.query]);
  });

  const packFeed = feedOf(
    ...['Show (01-12) [1080p]', 'Show (13-24) [1080p]', 'Show S2 (01-12) [1080p]'].map(
      (title, index) => release(index + 1, title, 'Mon, 01 Jan 2024 00:00:00 -0000')
    )
  );

  it('finally searches packs, keeping those that include the episode', async () => {
    const search = { title: 'Show', episode: 5 };
    const { packs } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (query) => new Response(query === packs!.query ? packFeed : emptyFeed));
    const response = await POST(request);
    const xml = await response.text();
    expect(xml).toContain('Show (01-12)');
    expect(xml).not.toContain('Show (13-24)');
    expect(xml).not.toContain('Show S2');
    expect(response.headers.get('X-Nyaa-Packs')).toBe('1');
    expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(packs!.query);
  });

  it('answers no releases when the packs search fails', async () => {
    const search = { title: 'Show', episode: 5 };
    const { packs } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (query) =>
      query === packs!.query ? new Response('blocked', { status: 503 }) : new Response(emptyFeed)
    );
    const response = await POST(request);
    expect(await response.text()).toBe(emptyFeed);
    expect(response.headers.get('X-Nyaa-Packs')).toBeNull();
  });

  it('does not rewrite or retry an empty custom search', async () => {
    const request = event({ title: 'Show', episode: 1, query: 'Custom 01' });
    vi.mocked(request.fetch).mockImplementation(async () => new Response(emptyFeed));
    expect(await (await POST(request)).text()).toBe(emptyFeed);
    expect(request.fetch).toHaveBeenCalledOnce();
  });

  it('rejects encoded custom queries that exceed the budget before charging or fetching', async () => {
    const request = event({ title: 'Show', episode: 1, query: '薬'.repeat(60) });
    await expect(POST(request)).rejects.toMatchObject({ status: 400 });
    expect(request.fetch).not.toHaveBeenCalled();
    expect(takeClientLimit).not.toHaveBeenCalled();
  });

  it('does not retry upstream rate limiting', async () => {
    const search = { title: 'Show', episode: 1 };
    const { lighter, packs } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockImplementation(async () => new Response('', { status: 429 }));
    await expect(POST(request)).rejects.toMatchObject({ status: 502 });
    expect(queriesOf(request)).not.toContain(lighter);
    expect(queriesOf(request)).not.toContain(packs!.query);
  });

  const stalledFetch = (_url: unknown, options?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      // As fetch does, for a request aborted before it starts too
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

  it('retries a timed-out search with its lighter query when nothing else was found', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { query, lighter } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (asked, options) =>
      asked === query
        ? stalledFetch(asked, options)
        : new Response(asked === lighter ? feed : emptyFeed)
    );
    const response = POST(request);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await (await response).text()).toBe(feed);
    expect(decodeURIComponent((await response).headers.get('X-Nyaa-Query')!)).toBe(lighter);
    expect(queriesOf(request).at(-1)).toBe(lighter);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers with the other searches when the first times out', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { query, lighter } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (asked, options) =>
      asked === query ? stalledFetch(asked, options) : new Response(feed)
    );
    const response = POST(request);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await (await response).text()).toBe(feed);
    expect(queriesOf(request)).not.toContain(lighter);
  });

  it('stops stalled upstream requests at the total deadline', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { lighter } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockImplementation(stalledFetch);
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(NYAA_SEARCH_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504 });
    expect(queriesOf(request).at(-1)).toBe(lighter);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not report no matches when the first search timed out and the others were empty', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { query } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (asked, options) =>
      asked === query ? stalledFetch(asked, options) : new Response(emptyFeed)
    );
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504 });
  });

  it('gives the last search only the remaining total budget', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { packs } = nyaaQueryPlan(search);
    const request = event(search);
    answer(request, async (asked, options) => {
      if (asked === packs!.query) return stalledFetch(asked, options);
      vi.setSystemTime(Date.now() + 10000);
      return new Response(emptyFeed);
    });
    const outcome = POST(request);
    await vi.advanceTimersByTimeAsync(2000);
    // The packs search timed out, so the searches before answer: no releases
    expect(await (await outcome).text()).toBe(emptyFeed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled response body and cancels its reader', async () => {
    vi.useFakeTimers();
    const request = event({ title: 'Show', episode: 1, query: 'Custom' });
    const cancel = vi.fn();
    vi.mocked(request.fetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates browser cancellation without trying a fallback', async () => {
    const search = { title: 'Show', episode: 1 };
    const { lighter, packs } = nyaaQueryPlan(search);
    const controller = new AbortController();
    const request = event(search, controller.signal);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(request.fetch).mockImplementation((url, options) => {
      started();
      return stalledFetch(url, options);
    });
    const outcome = POST(request).catch((error) => error);
    await entered;
    controller.abort();
    expect(await outcome).toMatchObject({ status: 499 });
    expect(queriesOf(request)).not.toContain(lighter);
    expect(queriesOf(request)).not.toContain(packs!.query);
  });

  describe('series numbered on from an earlier part', () => {
    const search = { title: 'Show 2nd Season', episode: 3, mediaId: 42 };
    const series = { arc: { offset: 12, title: 'Show', season: 2 }, related: [] };

    it("also looks for the episode's number in the whole series", async () => {
      vi.mocked(getSeries).mockResolvedValue(series);
      const request = event(search);
      await POST(request);
      expect(getSeries).toHaveBeenCalledWith(42);
      expect(queriesOf(request)[0]).toBe(nyaaQueryPlan(search, series).query);
      expect(queriesOf(request)[0]).toContain('"Show - 15"');
    });

    it.each([
      ['AniList fails', () => vi.mocked(getSeries).mockRejectedValue(new Error('offline'))],
      [
        'the series has no earlier part',
        () => vi.mocked(getSeries).mockResolvedValue({ arc: null, related: [] }),
      ],
    ])('searches the episode alone when %s', async (_case, setUp) => {
      setUp();
      const request = event(search);
      expect(await (await POST(request)).text()).toBe(feed);
      expect(queriesOf(request)[0]).toBe(nyaaQueryPlan(search).query);
    });

    it('stops waiting for AniList, out of the search time', async () => {
      vi.useFakeTimers();
      vi.mocked(getSeries).mockReturnValue(new Promise(() => {}));
      const request = event(search);
      const response = POST(request);
      await vi.advanceTimersByTimeAsync(NYAA_SERIES_LOOKUP_MS);
      expect(await (await response).text()).toBe(feed);
      expect(queriesOf(request)[0]).toBe(nyaaQueryPlan(search).query);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("adds the series search's releases that name the episode", async () => {
      vi.mocked(getSeries).mockResolvedValue(series);
      const plan = nyaaQueryPlan(search, series);
      const date = 'Mon, 01 Jan 2024 00:00:00 -0000';
      const request = event(search);
      answer(request, async (query) =>
        query === plan.seriesNumber!.query
          ? new Response(
              feedOf(
                release(1, 'Show S17E15 VOSTFR 1080p WEB-DL', date),
                release(2, 'Show 2nd Season - 07 [1080p][15F3DC8F]', date),
                release(3, 'Show S17E14 VOSTFR 1080p WEB-DL', date)
              )
            )
          : new Response(
              query === plan.query ? feedOf(release(4, 'Show S2 - 03 [1080p]', date)) : emptyFeed
            )
      );
      const xml = await (await POST(request)).text();
      expect(xml).toContain('Show S2 - 03');
      expect(xml).toContain('Show S17E15');
      expect(xml).not.toContain('15F3DC8F');
      expect(xml).not.toContain('S17E14');
    });

    it('keeps sukebei releases named with the native title and the episode its way', async () => {
      const adult = { ...search, adult: true };
      const native = { arc: null, related: [], native: '日本語タイトル' };
      vi.mocked(getSeries).mockResolvedValue(native);
      const plan = nyaaQueryPlan(adult, native);
      const date = 'Mon, 01 Jan 2024 00:00:00 -0000';
      const request = event(adult);
      answer(
        request,
        async (query) =>
          new Response(
            query === plan.words!.query
              ? feedOf(
                  release(1, '[Group] 日本語タイトル 第3話', date),
                  release(2, '[Group] 日本語タイトル ＃4', date)
                )
              : emptyFeed
          )
      );
      const xml = await (await POST(request)).text();
      expect(xml).toContain('第3話');
      expect(xml).not.toContain('＃4');
      expect(String(vi.mocked(request.fetch).mock.calls[0][0])).toMatch(
        /^https:\/\/sukebei\.nyaa\.si\//
      );
    });

    it('never asks AniList for a custom search or a client over its limit', async () => {
      await POST(event({ ...search, query: 'Custom 03' }));
      vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
      await expect(POST(event(search))).rejects.toMatchObject({ status: 429 });
      expect(getSeries).not.toHaveBeenCalled();
    });
  });
});

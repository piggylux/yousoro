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
        fetch.mockResolvedValue(
          failure === 'upstream error'
            ? new Response('blocked', { status: 503 })
            : new Response('x'.repeat(2_000_001))
        );
      await expect(POST(request)).rejects.toMatchObject({ status: 502 });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  const queriesOf = (request: RequestEvent) =>
    vi.mocked(request.fetch).mock.calls.map(([url]) => new URL(String(url)).searchParams.get('q'));

  it('tries the broader query only when the first feed is empty', async () => {
    const search = { title: 'Main Title', otherTitles: ['Other Title'], episode: 5 };
    const { query, broader } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockResolvedValueOnce(new Response(emptyFeed));
    const response = await POST(request);
    expect(await response.text()).toBe(feed);
    expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(broader);
    expect(queriesOf(request)).toEqual([query, broader]);
    // One read for each request to nyaa.si, as it's made
    expect(vi.mocked(takeClientLimit).mock.calls).toEqual([
      ['127.0.0.1', 'read'],
      ['127.0.0.1', 'read'],
    ]);
  });

  it('stops trying once the client has no reads left', async () => {
    vi.mocked(takeClientLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfter: 60 })
      .mockResolvedValue({ allowed: false, retryAfter: 60 });
    const request = event();
    vi.mocked(request.fetch).mockResolvedValue(new Response(emptyFeed));
    expect(await (await POST(request)).text()).toBe(emptyFeed);
    expect(request.fetch).toHaveBeenCalledOnce();
  });

  it('returns empty results after the broader query and the packs found nothing', async () => {
    const search = { title: 'Show', episode: 1 };
    const { query, broader, packs } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockImplementation(async () => new Response(emptyFeed));
    expect(await (await POST(request)).text()).toBe(emptyFeed);
    expect(queriesOf(request)).toEqual([query, broader, packs!.query]);
  });

  const packFeed = `<rss version="2.0"><channel><title>Nyaa</title>${[
    'Show (01-12) [1080p]',
    'Show (13-24) [1080p]',
    'Show S2 (01-12) [1080p]',
  ]
    .map((title) => `<item><title>${title}</title><link>x</link></item>`)
    .join('')}</channel></rss>`;

  it('finally searches packs, keeping those that include the episode', async () => {
    const search = { title: 'Show', episode: 5 };
    const { packs } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch)
      .mockResolvedValueOnce(new Response(emptyFeed))
      .mockResolvedValueOnce(new Response(emptyFeed))
      .mockResolvedValueOnce(new Response(packFeed));
    const response = await POST(request);
    const xml = await response.text();
    expect(xml).toContain('Show (01-12)');
    expect(xml).not.toContain('Show (13-24)');
    expect(xml).not.toContain('Show S2');
    expect(response.headers.get('X-Nyaa-Packs')).toBe('1');
    expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(packs!.query);
  });

  it('answers no releases when the packs search fails', async () => {
    const request = event({ title: 'Show', episode: 5 });
    vi.mocked(request.fetch)
      .mockResolvedValueOnce(new Response(emptyFeed))
      .mockResolvedValueOnce(new Response(emptyFeed))
      .mockResolvedValueOnce(new Response('blocked', { status: 503 }));
    const response = await POST(request);
    expect(await response.text()).toBe(emptyFeed);
    expect(response.headers.get('X-Nyaa-Packs')).toBeNull();
  });

  it('does not rewrite or retry an empty custom search', async () => {
    const request = event({ title: 'Show', episode: 1, query: 'Custom 01' });
    vi.mocked(request.fetch).mockResolvedValue(new Response(emptyFeed));
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
    const request = event();
    vi.mocked(request.fetch).mockResolvedValue(new Response('', { status: 429 }));
    await expect(POST(request)).rejects.toMatchObject({ status: 502 });
    expect(request.fetch).toHaveBeenCalledOnce();
  });

  const stalledFetch = (_url: unknown, options?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

  it('retries a timed-out search with its lighter query', async () => {
    vi.useFakeTimers();
    const search = { title: 'Show', episode: 1 };
    const { query, lighter } = nyaaQueryPlan(search);
    const request = event(search);
    vi.mocked(request.fetch).mockImplementationOnce(stalledFetch);
    const response = POST(request);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await (await response).text()).toBe(feed);
    expect(decodeURIComponent((await response).headers.get('X-Nyaa-Query')!)).toBe(lighter);
    expect(queriesOf(request)).toEqual([query, lighter]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops stalled upstream requests at the total deadline', async () => {
    vi.useFakeTimers();
    const request = event();
    vi.mocked(request.fetch).mockImplementation(stalledFetch);
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(NYAA_SEARCH_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504 });
    expect(request.fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not report no matches when one query timed out and the other was empty', async () => {
    vi.useFakeTimers();
    const request = event();
    vi.mocked(request.fetch)
      .mockImplementationOnce(stalledFetch)
      .mockResolvedValueOnce(new Response(emptyFeed));
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(NYAA_ATTEMPT_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ status: 504 });
    expect(request.fetch).toHaveBeenCalledTimes(2);
  });

  it('gives the fallback only the remaining total budget', async () => {
    vi.useFakeTimers();
    const request = event();
    vi.mocked(request.fetch)
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 10000);
        return new Response(emptyFeed);
      })
      .mockImplementation(stalledFetch);
    const outcome = POST(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await outcome).toMatchObject({ status: 504 });
    expect(request.fetch).toHaveBeenCalledTimes(2);
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
    const controller = new AbortController();
    const request = event(undefined, controller.signal);
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
    expect(request.fetch).toHaveBeenCalledOnce();
  });

  describe('series numbered on from an earlier part', () => {
    const search = { title: 'Show 2nd Season', episode: 3, mediaId: 42 };
    const series = { arc: { offset: 12, title: 'Show' }, related: [] };

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

    const item = (title: string) => `<item><title>${title}</title><link>x</link></item>`;
    const wideFeed = `<rss version="2.0"><channel><title>Nyaa</title>${[
      'Show S17E15 VOSTFR 1080p WEB-DL',
      'Show 2nd Season - 07 [1080p][15F3DC8F]',
      'Show S17E14 VOSTFR 1080p WEB-DL',
    ]
      .map(item)
      .join('')}</channel></rss>`;

    it("searches the series' number before more phrases, keeping only the releases naming it", async () => {
      vi.mocked(getSeries).mockResolvedValue(series);
      const plan = nyaaQueryPlan(search, series);
      const request = event(search);
      vi.mocked(request.fetch)
        .mockResolvedValueOnce(new Response(emptyFeed))
        .mockResolvedValueOnce(new Response(wideFeed));
      const response = await POST(request);
      const xml = await response.text();
      expect(xml).toContain('Show S17E15');
      expect(xml).not.toContain('15F3DC8F');
      expect(xml).not.toContain('S17E14');
      // The slower broader phrases are spared
      expect(queriesOf(request)).toEqual([plan.query, plan.wide!.query]);
      expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(plan.wide!.query);
      expect(takeClientLimit).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['fails', () => new Response('blocked', { status: 503 })],
      ['names other episodes only', () => new Response(wideFeed.replace('S17E15', 'S17E16'))],
    ])('tries the broader phrases when the series search %s', async (_case, wide) => {
      vi.mocked(getSeries).mockResolvedValue(series);
      const plan = nyaaQueryPlan(search, series);
      const request = event(search);
      vi.mocked(request.fetch)
        .mockResolvedValueOnce(new Response(emptyFeed))
        .mockResolvedValueOnce(wide())
        .mockResolvedValueOnce(new Response(feed));
      const response = await POST(request);
      expect(await response.text()).toBe(feed);
      expect(queriesOf(request)).toEqual([plan.query, plan.wide!.query, plan.broader]);
      expect(decodeURIComponent(response.headers.get('X-Nyaa-Query')!)).toBe(plan.broader);
    });

    it('never searches the series when the phrases find releases', async () => {
      vi.mocked(getSeries).mockResolvedValue(series);
      const request = event(search);
      await POST(request);
      expect(request.fetch).toHaveBeenCalledOnce();
    });

    it('never asks AniList for a custom search or a client over its limit', async () => {
      await POST(event({ ...search, query: 'Custom 03' }));
      vi.mocked(takeClientLimit).mockResolvedValue({ allowed: false, retryAfter: 20 });
      await expect(POST(event(search))).rejects.toMatchObject({ status: 429 });
      expect(getSeries).not.toHaveBeenCalled();
    });
  });
});

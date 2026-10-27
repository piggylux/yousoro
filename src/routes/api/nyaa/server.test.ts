import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nyaaSearchUrl } from '#lib/nyaa.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';

import { POST } from './+server.js';

vi.mock('#lib/server/rate-limit.js', () => ({ takeClientLimit: vi.fn() }));
const feed = '<rss version="2.0"><channel><item><title>Show - 01</title></item></channel></rss>';
function event(body: unknown = { title: 'Show', episode: 1 }) {
  return {
    locals: {},
    getClientAddress: () => '127.0.0.1',
    fetch: vi.fn().mockResolvedValue(new Response(feed)),
    request: new Request('https://example.test/api/nyaa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(takeClientLimit).mockResolvedValue({ allowed: true, retryAfter: 60 });
});

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
    }
  );
});

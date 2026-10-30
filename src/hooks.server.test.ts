import { type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SITE_ORIGIN } from '#lib/seo.js';
import { getMalSession, getSession } from '#lib/server/session.js';

import { handle } from './hooks.server';

vi.mock('$app/env', () => ({ building: false }));
// Whether the site has a MyAnimeList client, whatever the local environment has
const mal = vi.hoisted(() => ({ MAL_ENABLED: true }));
vi.mock('#lib/server/myanimelist-auth.js', () => mal);
vi.mock('#lib/server/session.js', () => ({ getSession: vi.fn(), getMalSession: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mal.MAL_ENABLED = true;
  vi.mocked(getSession).mockReturnValue(null);
  vi.mocked(getMalSession).mockReturnValue(null);
});
function event(path: string, origin = SITE_ORIGIN, routeId: string | null = null) {
  return {
    request: new Request(`${origin}${path}`),
    route: { id: routeId },
    locals: {},
    getClientAddress: () => '192.0.2.1',
    cookies: { get: () => undefined },
  } as unknown as RequestEvent;
}
function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
}

describe('request security', () => {
  it.each(['/home', '/user/anilist/fixture', '/user/anilist/fixture?view=calendar'])(
    'permits indexing successful public production pages: %s',
    async (path) => {
      const response = await handle({
        event: event(path),
        resolve: async () => new Response('fixture'),
      });
      expect(response.headers.get('X-Robots-Tag')).toBeNull();
    }
  );
  it.each(['/settings', '/auth/anilist/callback', '/api/nyaa', '/user/anilist/fixture/friends'])(
    'excludes utility pages from indexing: %s',
    async (path) => {
      const response = await handle({
        event: event(path),
        resolve: async () => new Response('fixture'),
      });
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    }
  );
  it('excludes preview hosts and errors even on public routes', async () => {
    for (const request of [event('/home', 'https://preview.vercel.app'), event('/home')]) {
      const response = await handle({
        event: request,
        resolve: async () => new Response('fixture', { status: 503 }),
      });
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    }
    const response = await handle({
      event: event('/home', 'https://preview.vercel.app'),
      resolve: async () => new Response('fixture'),
    });
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
  });
  it.each([
    [true, 'noindex, follow'],
    [false, null],
  ])('with MyAnimeList on: %s, counts its sign-in as one', async (enabled, robots) => {
    mal.MAL_ENABLED = enabled;
    vi.mocked(getMalSession).mockReturnValue({
      token: 'fixture',
      refreshToken: 'fixture',
      expiresAt: Infinity,
      user: { id: 1, name: 'fixture', avatarUrl: null },
    });
    const request = event('/user/anilist/fixture');
    const response = await handle({ event: request, resolve: async () => new Response('fixture') });
    expect(response.headers.get('X-Robots-Tag')).toBe(robots);
    expect(request.locals.malSession).toEqual(enabled ? expect.anything() : null);
  });

  it('does not index responses rendered with an account session', async () => {
    vi.mocked(getSession).mockReturnValue({
      token: 'fixture',
      user: { id: 1, name: 'fixture' },
    } as NonNullable<ReturnType<typeof getSession>>);
    const response = await handle({
      event: event('/user/anilist/fixture'),
      resolve: async () => new Response('fixture'),
    });
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expectPrivate(response);
  });
  it.each(['/settings', '/auth/logout', '/auth/anilist/callback?error=denied'])(
    'prevents caching responses from %s',
    async (path) => {
      const response = await handle({
        event: event(path),
        resolve: async () => new Response('fixture'),
      });
      expectPrivate(response);
      if (path.startsWith('/auth/'))
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    }
  );

  it.each([
    ['/preview.png', '/preview.png'],
    ['/user/anilist/fixture/preview.jpg', '/user/[domain]/[username]/preview.jpg'],
    ['/user/anilist/fixture/match/preview.jpg', '/user/[domain]/[username]/match/preview.jpg'],
    [
      '/user/anilist/fixture/match/other/preview.jpg',
      '/user/[domain]/[username]/match/[other]/preview.jpg',
    ],
    ['/api/taste/fixture', '/api/taste/[username]'],
  ])(
    'lets the public data at %s keep its own caching, even for a signed-in request',
    async (path, routeId) => {
      vi.mocked(getSession).mockReturnValue({
        token: 'fixture',
        user: { id: 1, name: 'fixture' },
      } as NonNullable<ReturnType<typeof getSession>>);
      const response = await handle({
        event: event(path, SITE_ORIGIN, routeId),
        resolve: async () =>
          new Response('image', { headers: { 'Cache-Control': 'public, max-age=3600' } }),
      });
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    }
  );

  it.each([
    // Only the route SvelteKit resolved counts, not what the path looks like
    ['/user/anilist/fixture/preview.jpg', '/user/[domain]/[username]'],
    ['/user/anilist/fixture/friends', '/user/[domain]/[username]/friends'],
    ['/user/anilist/fixture/match/other', '/user/[domain]/[username]/match/[[other]]'],
    ['/api/list/anilist/fixture', '/api/list/[domain]/[username]'],
    ['/preview.png/x', null],
  ])('keeps other routes private, whatever their path: %s', async (path, routeId) => {
    const response = await handle({
      event: event(path, SITE_ORIGIN, routeId),
      resolve: async () =>
        new Response('fixture', { headers: { 'Cache-Control': 'public, max-age=3600' } }),
    });
    expectPrivate(response);
  });

  it('emits the combined Retry-After once after the action and load', async () => {
    const request = event('/user/anilist/fixture');
    const response = await handle({
      event: request,
      resolve: async () => {
        request.locals.retryAfter = 12;
        request.locals.retryAfter = Math.max(request.locals.retryAfter, 30);
        return new Response('framework response', { status: 429 });
      },
    });
    expect(response.headers.get('Retry-After')).toBe('30');
    expectPrivate(response);
  });

  it.each([
    ['/user/anilist/fixture', 'text/html'],
    ['/user/anilist/fixture/__data.json', 'application/json'],
    ['/user/anilist/fixture?/updateEntry', 'application/json'],
    ['/api/friends/watching', 'application/json'],
  ])('preserves framework responses for %s', async (path, contentType) => {
    const expected = new Response('framework response', {
      status: 429,
      headers: { 'Content-Type': contentType, 'Retry-After': '19' },
    });
    const response = await handle({ event: event(path), resolve: async () => expected });
    expect(response).toBe(expected);
    expect(await response.text()).toBe('framework response');
    expect(response.headers.get('Content-Type')).toBe(contentType);
    expect(response.headers.get('Retry-After')).toBe('19');
    expectPrivate(response);
  });
});

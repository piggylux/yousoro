import { type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSession } from '#lib/server/session.js';

import { handle } from './hooks.server';

vi.mock('$app/env', () => ({ building: false }));
vi.mock('#lib/server/session.js', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockReturnValue(null);
});
function event(path: string) {
  return {
    request: new Request(`https://yousoro.example${path}`),
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

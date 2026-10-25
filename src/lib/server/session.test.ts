import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { getSession, isAccessToken } from '#lib/server/session.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MDUzOSJ9.c2lnbmF0dXJl';

function cookiesWith(value: unknown): Cookies {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return { get: (name: string) => (name === 'session' ? raw : undefined) } as Cookies;
}

describe('isAccessToken', () => {
  it('accepts a JWT', () => {
    expect(isAccessToken(TOKEN)).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a non-string', 42],
    ['two parts', 'abc.def'],
    ['a line break, which would break the Authorization header', `${TOKEN}\r\nX-Evil: 1`],
    ['spaces', 'abc.def.ghi jkl'],
    ['an oversized value', `${'a'.repeat(4096)}.b.c`],
  ])('refuses %s', (_, value) => {
    expect(isAccessToken(value)).toBe(false);
  });
});

describe('getSession', () => {
  const user = { id: 40539, name: 'Piggylux', avatarUrl: 'https://s4.anilist.co/avatar.png' };

  it('reads a valid session', () => {
    expect(getSession(cookiesWith({ token: TOKEN, user }))).toEqual({ token: TOKEN, user });
  });

  it('refuses a session whose token isn’t a JWT', () => {
    expect(getSession(cookiesWith({ token: 'not a token', user }))).toBeNull();
  });

  it('drops an avatar URL that isn’t https', () => {
    const session = getSession(
      cookiesWith({ token: TOKEN, user: { ...user, avatarUrl: 'javascript:alert(1)' } })
    );
    expect(session?.user.avatarUrl).toBeNull();
  });

  it.each([
    ['no cookie', undefined],
    ['broken JSON', '{nope'],
    ['a missing user', { token: TOKEN }],
    ['a non-integer user id', { token: TOKEN, user: { ...user, id: '40539' } }],
  ])('is signed out with %s', (_, value) => {
    const cookies =
      value === undefined ? ({ get: () => undefined } as unknown as Cookies) : cookiesWith(value);
    expect(getSession(cookies)).toBeNull();
  });
});

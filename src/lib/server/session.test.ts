import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import {
  getMalSession,
  getSession,
  isAccessToken,
  isBearerToken,
  setMalSession,
  setSession,
} from '#lib/server/session.js';

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

describe('session cookie versions', () => {
  const user = { id: 40539, name: 'Piggylux', avatarUrl: null };

  it('writes a versioned cookie that reads back', () => {
    const jar = new Map<string, string>();
    const cookies = {
      get: (name: string) => jar.get(name),
      set: (name: string, value: string) => void jar.set(name, value),
    } as unknown as Cookies;

    setSession(cookies, { token: TOKEN, user }, 3600);

    expect(JSON.parse(jar.get('session') ?? '')).toMatchObject({ v: 1 });
    expect(getSession(cookies)).toEqual({ token: TOKEN, user });
  });

  it('still reads a session saved before versioning', () => {
    expect(getSession(cookiesWith({ token: TOKEN, user }))).toEqual({ token: TOKEN, user });
  });

  it('ignores a session from a newer format', () => {
    expect(getSession(cookiesWith({ v: 2, data: { token: TOKEN, user } }))).toBeNull();
  });
});

describe('MyAnimeList session', () => {
  const user = { id: 12, name: 'Fixture', avatarUrl: 'https://cdn.myanimelist.net/avatar.jpg' };
  const session = { token: TOKEN, refreshToken: 'def50200abc', expiresAt: 1_000, user };

  function jar() {
    const values = new Map<string, string>();
    const cookies = {
      get: (name: string) => values.get(name),
      set: (name: string, value: string) => void values.set(name, value),
    } as unknown as Cookies;
    return { values, cookies };
  }

  it('is kept in its own cookie, beside the AniList one', () => {
    const { values, cookies } = jar();
    setMalSession(cookies, session);
    expect(values.has('session')).toBe(false);
    expect(getMalSession(cookies)).toEqual(session);
    expect(getSession(cookies)).toBeNull();
  });

  it.each([
    ['a refresh token that could break a form body', { ...session, refreshToken: 'a&b=c' }],
    ['a missing expiry', { ...session, expiresAt: undefined }],
    ['a missing user', { ...session, user: undefined }],
  ])('is signed out with %s', (_, value) => {
    const { values, cookies } = jar();
    values.set('session_mal', JSON.stringify({ v: 1, data: value }));
    expect(getMalSession(cookies)).toBeNull();
  });
});

describe('isBearerToken', () => {
  it.each([TOKEN, 'def50200abc', 'abc+/=='])('accepts %s', (value) => {
    expect(isBearerToken(value)).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a line break', `${TOKEN}\r\nX-Evil: 1`],
    ['a space', 'abc def'],
    ['an oversized value', 'a'.repeat(4097)],
  ])('refuses %s', (_, value) => {
    expect(isBearerToken(value)).toBe(false);
  });
});

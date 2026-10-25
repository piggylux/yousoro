import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { getPreferences, setPreferences } from '#lib/server/preferences.js';

function cookiesWith(value?: string) {
  const jar = new Map<string, string>(value === undefined ? [] : [['preferences', value]]);
  return {
    get: (name: string) => jar.get(name),
    set: (name: string, newValue: string) => void jar.set(name, newValue),
  } as unknown as Cookies;
}

describe('getPreferences', () => {
  it('blurs mature covers by default', () => {
    expect(getPreferences(cookiesWith())).toEqual({ blurMature: true });
  });

  it('reads a saved choice', () => {
    expect(getPreferences(cookiesWith('{"v":1,"data":{"blurMature":false}}'))).toEqual({
      blurMature: false,
    });
  });

  it.each([
    ['a garbled cookie', 'maybe'],
    ['the wrong type', '{"v":1,"data":{"blurMature":"no"}}'],
    ['a newer format', '{"v":2,"data":{"blurMature":false}}'],
  ])('stays on the safe side with %s', (_, value) => {
    expect(getPreferences(cookiesWith(value)).blurMature).toBe(true);
  });
});

describe('setPreferences', () => {
  it('round-trips both choices', () => {
    for (const blurMature of [true, false]) {
      const cookies = cookiesWith();
      setPreferences(cookies, { blurMature });
      expect(getPreferences(cookies)).toEqual({ blurMature });
    }
  });
});

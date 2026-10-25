import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from '#lib/server/redirect.js';

describe('safeRedirectPath', () => {
  it.each([
    ['/user/anilist/Piggylux', '/user/anilist/Piggylux'],
    ['/user/anilist/Piggylux?x=1#top', '/user/anilist/Piggylux?x=1#top'],
  ])('keeps a path on this site: %s', (path, expected) => {
    expect(safeRedirectPath(path)).toBe(expected);
  });

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a tab trick', '/\t/evil.example'],
    ['a newline trick', '/\n/evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'home'],
    ['a non-string', 42],
  ])('sends %s to /home', (_, path) => {
    expect(safeRedirectPath(path)).toBe('/home');
  });
});

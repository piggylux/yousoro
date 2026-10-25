import { describe, expect, it } from 'vitest';

import { type CookieFormat, readVersioned, writeVersioned } from '#lib/server/versioned-cookie.js';

// A made-up format at version 2: version 1 called the field `name`, version 0 was a bare string
type Data = { title: string };
const format: CookieFormat<Data> = {
  version: 2,
  parse: (data) =>
    typeof data === 'object' && data !== null && 'title' in data && typeof data.title === 'string'
      ? { title: data.title }
      : null,
  migrations: {
    0: (data) => ({ name: data }),
    1: (data) => ({ title: (data as { name: string }).name }),
  },
};

describe('readVersioned', () => {
  it('reads what writeVersioned wrote', () => {
    expect(readVersioned(writeVersioned({ title: 'Yousoro' }, format), format)).toEqual({
      title: 'Yousoro',
    });
  });

  it('migrates an older version step by step', () => {
    expect(readVersioned('{"v":1,"data":{"name":"Yousoro"}}', format)).toEqual({
      title: 'Yousoro',
    });
  });

  it('migrates a cookie written before versioning, as version 0', () => {
    expect(readVersioned('"Yousoro"', format)).toEqual({ title: 'Yousoro' });
  });

  it.each([
    ['a newer version', '{"v":3,"data":{"title":"Yousoro"}}'],
    ['a negative version', '{"v":-1,"data":{"title":"Yousoro"}}'],
    ['data that does not fit', '{"v":2,"data":{"title":42}}'],
    ['broken JSON', '{nope'],
    ['no cookie', undefined],
  ])('ignores %s', (_, raw) => {
    expect(readVersioned(raw, format)).toBeNull();
  });

  it('ignores an old version with no migration', () => {
    const strict: CookieFormat<Data> = { ...format, migrations: {} };
    expect(readVersioned('{"v":1,"data":{"name":"Yousoro"}}', strict)).toBeNull();
  });
});

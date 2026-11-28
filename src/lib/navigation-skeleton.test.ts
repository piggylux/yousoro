import { describe, expect, it } from 'vitest';

import { ownsList, skeletonFor } from '#lib/navigation-skeleton.js';

const place = (path: string, id: string | null) => ({
  url: new URL(path, 'https://example.test'),
  route: { id },
});
const LIST = '/user/[domain]/[username]';
const from = place('/settings', '/settings');

describe('skeletonFor', () => {
  it.each([
    ['/user/anilist/Alice', LIST, 'list'],
    ['/user/anilist/Alice?view=calendar', LIST, 'calendar'],
    ['/user/myanimelist/Alice/planning', `${LIST}/planning`, 'planning'],
    ['/user/anilist/Alice/friends', `${LIST}/friends`, 'friends'],
    ['/sync', '/sync', 'sync'],
  ])('shows a skeleton shaped like %s', (path, id, kind) => {
    expect(skeletonFor({ from, to: place(path, id), type: 'link' })).toBe(kind);
  });

  it('shows none for pages that show at once', () => {
    for (const [path, id] of [
      ['/settings', '/settings'],
      ['/user/anilist/Alice/season', `${LIST}/season/[[season]]`],
      ['/user/anilist/Alice/match', `${LIST}/match/[[other]]`],
      ['/nowhere', null],
    ] as const) {
      expect(skeletonFor({ from: place('/', '/'), to: place(path, id), type: 'link' })).toBeNull();
    }
  });

  it('switches between the cards and the calendar with a skeleton of the other', () => {
    const cards = place('/user/anilist/Alice', LIST);
    const calendar = place('/user/anilist/Alice?view=calendar', LIST);
    expect(skeletonFor({ from: cards, to: calendar, type: 'link' })).toBe('calendar');
    expect(skeletonFor({ from: calendar, to: cards, type: 'popstate' })).toBe('list');
  });

  it('keeps the page on screen while the same page loads again, as a retry does', () => {
    const list = place('/user/anilist/Alice', LIST);
    expect(skeletonFor({ from: list, to: place('/user/anilist/Alice', LIST), type: 'goto' })).toBe(
      null
    );
  });

  it('shows none for forms sent without script, or before there is a navigation', () => {
    const list = place('/user/anilist/Alice', LIST);
    expect(skeletonFor({ from, to: list, type: 'form' })).toBeNull();
    expect(skeletonFor({ from: null, to: list, type: 'enter' })).toBeNull();
    expect(skeletonFor({ from, to: null, type: null })).toBeNull();
  });
});

describe('ownsList', () => {
  const accounts = { user: { name: 'Alice' }, malUser: { name: 'alice_mal' } };

  it('knows the viewer by the account they signed in with on that list', () => {
    expect(ownsList({ domain: 'anilist', username: 'alice' }, accounts)).toBe(true);
    expect(ownsList({ domain: 'myanimelist', username: 'Alice_MAL' }, accounts)).toBe(true);
    expect(ownsList({ domain: 'myanimelist', username: 'Alice' }, accounts)).toBe(false);
  });

  it("is someone else's list for anyone else, and for a visitor who isn't signed in", () => {
    expect(ownsList({ domain: 'anilist', username: 'Bob' }, accounts)).toBe(false);
    expect(ownsList({ domain: 'anilist', username: 'Alice' }, { user: null })).toBe(false);
    expect(ownsList({}, accounts)).toBe(false);
  });
});

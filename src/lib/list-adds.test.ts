import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import type { FoundAnime, FoundState } from '#lib/anime-search.js';
import AddToListActions from '#lib/components/AddToListActions.svelte';
import { ListAdds } from '#lib/list-adds.svelte.js';

const anime: FoundAnime = {
  id: 7,
  malId: 1007,
  title: 'Frieren',
  englishTitle: null,
  coverUrl: null,
  isAdult: false,
  status: 'RELEASING',
  format: 'TV',
  episodes: 12,
  startDate: { year: 2026, month: 10, day: 1 },
  planned: false,
  year: 2026,
  prequels: [],
  continues: null,
  parents: [],
  sideOf: null,
};

const adds = () =>
  new ListAdds({ domain: () => 'anilist', signedIn: () => ({}), announce: () => {} });

/** The hidden fields of each form the buttons render, in order */
function forms(props: { adds: ListAdds; where: FoundState; known?: boolean }) {
  const { body } = render(AddToListActions, {
    props: { anime, focusFallback: () => null, ...props },
  });
  return [...body.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map(([, inner]) =>
    Object.fromEntries(
      [...inner.matchAll(/<input type="hidden" name="(\w+)" value="([^"]*)"/g)].map(
        ([, name, value]) => [name, value]
      )
    )
  );
}

describe('what the add buttons send', () => {
  it('ask first, from a page that only found the anime, as a search does', () => {
    const sent = forms({ adds: adds(), where: { kind: 'new' } });

    expect(sent.map(({ list }) => list)).toEqual(['CURRENT', 'PLANNING']);
    for (const fields of sent) {
      expect(fields).not.toHaveProperty('known');
      expect(fields).not.toHaveProperty('from');
    }
  });

  it('vouch for where the anime is when the page read the list itself', () => {
    expect(forms({ adds: adds(), where: { kind: 'new' }, known: true })).toEqual([
      { mediaId: '7', malId: '1007', list: 'CURRENT', from: 'NONE', known: '1' },
      { mediaId: '7', malId: '1007', list: 'PLANNING', from: 'NONE', known: '1' },
    ]);
    expect(forms({ adds: adds(), where: { kind: 'listed', list: 'PAUSED' }, known: true })).toEqual(
      [{ mediaId: '7', malId: '1007', list: 'CURRENT', from: 'PAUSED', known: '1' }]
    );
  });

  it('never vouch when trying the linked account again, which relies on the add having stuck', () => {
    const planned = adds();
    planned.entries[anime.id] = {
      saving: false,
      added: 'PLANNING',
      before: 'NONE',
      linked: { message: 'MyAnimeList was busy', retry: true },
    };

    const [start, undo, retry] = forms({ adds: planned, where: { kind: 'new' }, known: true });

    // Starting what was just planned vouches that it's planned
    expect(start).toMatchObject({ list: 'CURRENT', from: 'PLANNING', known: '1' });
    expect(undo).toMatchObject({ list: 'PLANNING', before: 'NONE' });
    expect(retry).toEqual({ mediaId: '7', malId: '1007', list: 'PLANNING', retry: 'linked' });
  });
});

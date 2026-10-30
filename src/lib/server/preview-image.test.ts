import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  badgeAnime,
  badgeLine,
  badgeProgress,
  badgeVariant,
  describeList,
  describeMatchPreview,
  renderBadge,
  renderGroupPreview,
  renderListPreview,
  renderMatchInvitePreview,
  renderMatchPreview,
  renderSitePreview,
  renderWrappedPreview,
} from '#lib/server/preview-image.js';
import type { Anime } from '#lib/types/anime.js';
import type { ScoredAnime, TasteMatch, TasteProfile } from '#lib/types/match.js';

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 1,
    malId: null,
    title: 'Anime',
    englishTitle: null,
    otherTitles: [],
    thumbnailUrl: '',
    status: 'RELEASING',
    isAdult: false,
    meanScore: null,
    userScore: null,
    currentEpisode: 0,
    rewatching: false,
    lastUpdatedAt: null,
    nextEpisode: null,
    recentEpisodeAiredAt: null,
    numberAiredEpisodes: null,
    endDate: new Date(0),
    numberEpisodes: 0,
    ...overrides,
  };
}

// The smallest PNG there is, one transparent pixel, standing in for AniList's covers
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

/** The format and size of a drawn image, and that it matches the type the response says */
async function imageOf(response: Response) {
  const { format, width, height } = await sharp(await response.arrayBuffer()).metadata();
  expect(response.headers.get('content-type')).toBe(`image/${format}`);
  return { format, width, height };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('list preview text', () => {
  it('says when the list is empty', () => {
    expect(describeList([]).headline).toBe('Not watching anything right now');
  });

  it('counts the backlog, leaving rewatches out as the banner does', () => {
    expect(
      describeList([
        anime({ id: 1, numberAiredEpisodes: 1200, currentEpisode: 0 }),
        anime({ id: 2, numberAiredEpisodes: 12, currentEpisode: 11 }),
        anime({ id: 3, numberAiredEpisodes: 12, currentEpisode: 2, rewatching: true }),
      ])
    ).toEqual({
      headline: '1,201 episodes to catch up on',
      detail: 'Watching 3 anime · behind on 2',
    });
    expect(describeList([anime({ numberAiredEpisodes: 2, currentEpisode: 1 })]).headline).toBe(
      '1 episode to catch up on'
    );
  });

  it('celebrates a caught-up list', () => {
    expect(describeList([anime({ numberAiredEpisodes: 3, currentEpisode: 3 })])).toEqual({
      headline: 'All caught up',
      detail: 'Watching 1 anime',
    });
  });
});

describe('preview images', () => {
  it('draws the site preview at the size link previews use, as a PNG by default', async () => {
    const response = await renderSitePreview('public, max-age=60');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await imageOf(response)).toEqual({ format: 'png', width: 1200, height: 630 });
    // Also drawn as a JPEG in place of a list's preview, whose URL says it's one
    expect(await imageOf(await renderSitePreview('public, max-age=60', 'jpeg'))).toEqual({
      format: 'jpeg',
      width: 1200,
      height: 630,
    });
  });

  it('draws the site preview once, and still answers each request with the whole image', async () => {
    const first = await renderSitePreview('public, max-age=60', 'jpeg');
    const second = await renderSitePreview('no-store', 'jpeg');
    expect(second.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await second.arrayBuffer())).toEqual(Buffer.from(await first.arrayBuffer()));
    expect((await imageOf(await renderSitePreview('no-store', 'jpeg'))).width).toBe(1200);
  });

  it('draws a list as a JPEG from its covers, leaving out adult anime and other hosts’ images', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);

    const response = await renderListPreview(
      {
        username: 'Fixture',
        avatarUrl: 'https://s4.anilist.co/avatar.png',
        animeList: [
          anime({ id: 1, thumbnailUrl: 'https://s4.anilist.co/cover-1.jpg' }),
          anime({ id: 2, thumbnailUrl: 'https://s4.anilist.co/adult.jpg', isAdult: true }),
          anime({ id: 3, thumbnailUrl: 'https://example.com/cover-3.jpg' }),
        ],
      },
      'public, max-age=3600'
    );

    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/avatar.png',
      'https://s4.anilist.co/cover-1.jpg',
    ]);
  });

  it('still draws the list when its covers fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Not found', { status: 404 }))
    );
    const response = await renderListPreview(
      {
        username: 'Fixture',
        avatarUrl: null,
        animeList: [anime({ thumbnailUrl: 'https://s4.anilist.co/cover.jpg' })],
      },
      'public, max-age=3600'
    );
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
  });
});

function taster(name: string, scored: ScoredAnime[]): TasteProfile {
  return {
    id: 1,
    name,
    avatarUrl: `https://s4.anilist.co/${name}.png`,
    scoreFormat: 'POINT_100',
    scored,
    seen: [],
    planned: [],
  };
}

function scoredAnime(id: number, score: number, isAdult = false): ScoredAnime {
  return {
    id,
    title: `Anime ${id}`,
    coverUrl: `https://s4.anilist.co/cover-${id}.jpg`,
    isAdult,
    meanScore: null,
    score,
    score100: score,
  };
}

describe('match previews', () => {
  const match = (overrides: Partial<TasteMatch>): TasteMatch => ({
    percent: null,
    inCommon: 0,
    bothScored: 0,
    bothLoved: [],
    disagreements: [],
    picksForA: [],
    picksForB: [],
    ...overrides,
  });

  it('leads with the percent, or with what they have in common when there is none', () => {
    expect(describeMatchPreview(match({ percent: 82, inCommon: 1200 }))).toEqual({
      headline: '82%',
      detail: 'Watch-party ready',
      note: '1,200 anime in common',
    });
    expect(describeMatchPreview(match({ inCommon: 3 }))).toEqual({
      headline: '3',
      detail: 'anime in common',
      note: 'Too few scored by both to compare yet',
    });
  });

  it('draws a match from both avatars and the covers of anime both loved, never adult ones', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    const scores = [90, 80, 70, 60, 50];
    const alice = taster('Alice', [
      ...scores.map((score, index) => scoredAnime(index + 1, score)),
      scoredAnime(9, 100, true),
    ]);
    const bob = taster('Bob', [
      ...scores.map((score, index) => scoredAnime(index + 1, score)),
      scoredAnime(9, 100, true),
    ]);

    const response = await renderMatchPreview(alice, bob, 'public, max-age=3600');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/Alice.png',
      'https://s4.anilist.co/Bob.png',
      'https://s4.anilist.co/cover-1.jpg',
      'https://s4.anilist.co/cover-2.jpg',
    ]);
  });

  it('draws an invitation from the anime someone scored highest, never adult ones', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    const alice = taster('Alice', [scoredAnime(1, 70), scoredAnime(2, 90, true)]);
    const response = await renderMatchInvitePreview(alice, 'public, max-age=3600');
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/Alice.png',
      'https://s4.anilist.co/cover-1.jpg',
    ]);
  });
});

describe('profile badges', () => {
  it('says the episode each cover is on, of how many when AniList knows', () => {
    expect(badgeProgress(anime({ currentEpisode: 7, numberEpisodes: 12 }))).toBe('Ep 7 / 12');
    expect(badgeProgress(anime({ currentEpisode: 1100, numberEpisodes: 0 }))).toBe('Ep 1100');
  });

  it('speaks for its owner about where they are with their list', () => {
    expect(badgeLine([])).toEqual({ line: 'Between shows.', quip: 'Taking suggestions.' });
    expect(badgeLine([anime({ rewatching: true, currentEpisode: 2, numberEpisodes: 12 })])).toEqual(
      {
        line: 'Rewatching an old favorite.',
        quip: 'Never gets old.',
      }
    );
    expect(
      badgeLine([
        anime({ id: 1, currentEpisode: 11, numberEpisodes: 12, numberAiredEpisodes: 12 }),
        anime({ id: 2, currentEpisode: 0, numberAiredEpisodes: 50 }),
      ])
    ).toEqual({ line: 'One episode from a finale.', quip: 'No spoilers!' });
    expect(badgeLine([anime({ currentEpisode: 0, numberAiredEpisodes: 1200 })])).toEqual({
      line: '1,200 episodes behind.',
      quip: 'Send snacks.',
    });
    expect(badgeLine([anime({ currentEpisode: 2, numberAiredEpisodes: 3 })])).toEqual({
      line: '1 episode to go.',
      quip: 'Almost caught up!',
    });
  });

  it('tells a caught-up owner waiting on an episode from one with nothing coming', () => {
    const caughtUp = { currentEpisode: 3, numberEpisodes: 24, numberAiredEpisodes: 3 };
    expect(badgeLine([anime({ ...caughtUp, nextEpisode: { number: 4, airsAt: 1 } })]).quip).toBe(
      'The wait is the hardest part.'
    );
    expect(badgeLine([anime(caughtUp)]).quip).toBe('Taking suggestions.');
  });

  it('picks one of several jokes, going round them in turn', () => {
    const behind = [anime({ currentEpisode: 0, numberAiredEpisodes: 40 })];
    const quips = [0, 1, 2, 3, 4].map((variant) => badgeLine(behind, variant).quip);
    expect(new Set(quips.slice(0, 4)).size).toBe(4);
    expect(quips[4]).toBe(quips[0]);
    expect(badgeLine(behind, 3).line).toBe('40 episodes behind.');
  });

  it('keeps an owner’s joke all week, whatever the spelling of their name, then moves on', () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const start = Math.floor(Date.UTC(2026, 9, 29) / week) * week;
    expect(badgeVariant('Alice', start + week - 1)).toBe(badgeVariant('alice', start));
    expect(badgeVariant('Alice', start + week)).toBe(badgeVariant('Alice', start) + 1);
    expect(badgeVariant('Alice', start)).not.toBe(badgeVariant('Bob', start));
  });

  it('only counts a finale the badge shows, and never a movie', () => {
    const finale = { currentEpisode: 11, numberEpisodes: 12, numberAiredEpisodes: 12 };
    // Behind five more recently watched shows, its cover isn't on the badge
    const recent = Array.from({ length: 5 }, (_, id) =>
      anime({ id: id + 2, currentEpisode: 1, numberAiredEpisodes: 3, lastUpdatedAt: 100 })
    );
    expect(badgeLine([anime({ id: 1, ...finale, lastUpdatedAt: 1 }), ...recent]).line).toBe(
      '11 episodes behind.'
    );
    expect(
      badgeLine([anime({ currentEpisode: 0, numberEpisodes: 1, numberAiredEpisodes: 1 })]).line
    ).toBe('1 episode to go.');
  });

  it('shows what was watched most recently, never unstarted or adult anime', () => {
    const shown = badgeAnime([
      anime({ id: 1, currentEpisode: 3, lastUpdatedAt: 100 }),
      anime({ id: 2, currentEpisode: 0, lastUpdatedAt: 900 }),
      anime({ id: 3, currentEpisode: 5, lastUpdatedAt: 500 }),
      anime({ id: 4, currentEpisode: 8, lastUpdatedAt: 800, isAdult: true }),
      anime({ id: 5, currentEpisode: 1, lastUpdatedAt: null }),
      anime({ id: 6, currentEpisode: 2, lastUpdatedAt: 300, rewatching: true }),
    ]);
    expect(shown.map(({ id }) => id)).toEqual([3, 6, 1, 5]);
    const many = Array.from({ length: 9 }, (_, id) => anime({ id, currentEpisode: 1 }));
    expect(badgeAnime(many)).toHaveLength(5);
  });

  it('draws a badge at twice the size it is shown, never with unstarted anime', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    const response = await renderBadge(
      {
        username: 'Fixture',
        avatarUrl: 'https://s4.anilist.co/avatar.png',
        animeList: [
          anime({ id: 1, currentEpisode: 2, thumbnailUrl: 'https://s4.anilist.co/cover-1.jpg' }),
          anime({ id: 2, currentEpisode: 0, thumbnailUrl: 'https://s4.anilist.co/cover-2.jpg' }),
        ],
      },
      'dark',
      'public, max-age=3600'
    );
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 360 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/avatar.png',
      'https://s4.anilist.co/cover-1.jpg',
    ]);
  });

  it('draws a badge of the site alone for a list that cannot be read', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await imageOf(await renderBadge(null, 'light', 'no-store'))).toEqual({
      format: 'jpeg',
      width: 1200,
      height: 360,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('group previews', () => {
  it('draws a group from everyone’s avatars and the covers of its picks', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    // Alice has seen 1, so only Bob's plan to watch 2 is a pick
    const alice = taster('Alice', [scoredAnime(1, 90)]);
    const bob = { ...taster('Bob', []), id: 2, planned: [scoredAnime(1, 0), scoredAnime(2, 0)] };
    const response = await renderGroupPreview([alice, bob], 'public, max-age=3600');
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/Alice.png',
      'https://s4.anilist.co/Bob.png',
      'https://s4.anilist.co/cover-2.jpg',
    ]);
  });

  it('draws an invitation from what its host plans to watch, not what they have seen', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    const alice = { ...taster('Alice', [scoredAnime(1, 90)]), planned: [scoredAnime(2, 0)] };
    const response = await renderGroupPreview([alice], 'public, max-age=3600');
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/Alice.png',
      'https://s4.anilist.co/cover-2.jpg',
    ]);
  });
});

describe('year previews', () => {
  it('draws a year in anime from its favorites, never adult ones', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } })
    );
    vi.stubGlobal('fetch', fetch);
    const finished = (id: number, isAdult = false) => ({
      ...scoredAnime(id, 80, isAdult),
      episodes: 12,
      minutes: 288,
      month: 3,
      genres: ['Drama'],
    });
    const response = await renderWrappedPreview(
      {
        id: 1,
        name: 'Alice',
        avatarUrl: 'https://s4.anilist.co/Alice.png',
        scoreFormat: 'POINT_100',
        year: 2026,
        finished: [finished(1), finished(2, true)],
      },
      'public, max-age=3600'
    );
    expect(await imageOf(response)).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(fetch.mock.calls.map(([url]) => url).toSorted()).toEqual([
      'https://s4.anilist.co/Alice.png',
      'https://s4.anilist.co/cover-1.jpg',
    ]);
  });
});

import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeList, renderListPreview, renderSitePreview } from '#lib/server/preview-image.js';
import type { Anime } from '#lib/types/anime.js';

function anime(overrides: Partial<Anime>): Anime {
  return {
    id: 1,
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

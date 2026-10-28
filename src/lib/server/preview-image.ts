import { ImageResponse } from '@vercel/og';
import sharp from 'sharp';

import { getBacklog, sortWatchingList, withoutHiddenMature } from '#lib/anime.js';
import YouSvg from '#lib/images/minimalist_you.svg?inline';
import { PREVIEW_IMAGE_SIZE } from '#lib/seo.js';
import type { Anime } from '#lib/types/anime.js';

/*
 * The light theme's colours from src/app.css. The image is drawn on the server, without the page's
 * CSS, so it can't read the shared tokens: keep these in step with them
 */
const COLORS = {
  page: '#f7f8fa',
  border: '#dcdfe5',
  heading: '#202630',
  accent: '#596474',
  blue: '#2463a6',
};

/** Covers shown on a list's preview, the anime the owner is most actively watching first */
const PREVIEW_COVERS = 5;

type ImageFormat = 'png' | 'jpeg';
type Style = Record<string, string | number>;
type Element = { type: string; props: Record<string, unknown> };
type Child = Element | string | null;

/**
 * An element for the image renderer, which reads the same shape as a React element. It takes any
 * array of children for several, which only flex layouts allow, so a lone child is passed as is
 */
function el(type: string, style: Style, ...children: Child[]): Element {
  const shown = children.filter((child) => child !== null);
  return { type, props: { style, children: shown.length === 1 ? shown[0] : shown } };
}

function img(src: string, width: number, height: number, style: Style = {}): Element {
  return { type: 'img', props: { src, width, height, style } };
}

/** What a list's preview says about it: the backlog, or that its owner is caught up */
export function describeList(animeList: Anime[]): { headline: string; detail: string } {
  if (animeList.length === 0) {
    return { headline: 'Not watching anything right now', detail: 'Anime watching list' };
  }
  const { episodes, anime } = getBacklog(animeList);
  const watching = `Watching ${animeList.length.toLocaleString('en-US')} anime`;
  if (episodes === 0) return { headline: 'All caught up', detail: watching };
  return {
    headline: `${episodes.toLocaleString('en-US')} episode${episodes === 1 ? '' : 's'} to catch up on`,
    detail: `${watching} · behind on ${anime.toLocaleString('en-US')}`,
  };
}

/**
 * Fetches an AniList image as a data URL, so a slow or broken one is left out of the preview
 * rather than failing it. Only AniList's CDN is fetched, and only image types the renderer reads
 */
async function loadImage(url: string | null): Promise<string | null> {
  if (!url?.startsWith('https://s4.anilist.co/')) return null;
  try {
    // A redirect could lead off AniList's CDN, so it's refused as the API client does
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!response.ok || !['image/jpeg', 'image/png', 'image/gif'].includes(type)) {
      // Frees the connection now rather than once the unread body is collected
      await response.body?.cancel();
      return null;
    }
    const data = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function wordmark(fontSize: number): Element {
  return el(
    'div',
    { display: 'flex', fontSize, color: COLORS.heading },
    'Yousoro',
    el('span', { color: COLORS.blue }, '!')
  );
}

/**
 * Draws the whole image before answering: the renderer otherwise draws it as the response streams,
 * and a failure then cuts the response off instead of reaching the caller. Covers are photos, so a
 * list's preview is a JPEG: as a PNG it is several times larger, too large for some chat apps
 */
async function draw(element: Element, format: ImageFormat): Promise<Uint8Array<ArrayBuffer>> {
  const png = await new ImageResponse(element as never, PREVIEW_IMAGE_SIZE).arrayBuffer();
  return new Uint8Array(
    format === 'png' ? png : await sharp(png).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
  );
}

function imageResponse(
  image: Uint8Array<ArrayBuffer>,
  format: ImageFormat,
  cacheControl: string
): Response {
  return new Response(image, {
    headers: { 'Content-Type': `image/${format}`, 'Cache-Control': cacheControl },
  });
}

/**
 * The preview of a list as anyone sees it: covers of what its owner is watching and how far
 * behind they are. Anime AniList marks as adult are always left out, as for a visitor who hasn't
 * chosen to see them
 */
export async function renderListPreview(
  list: { username: string; avatarUrl: string | null; animeList: Anime[] },
  cacheControl: string
): Promise<Response> {
  const animeList = withoutHiddenMature(list.animeList, false);
  const [avatar, ...covers] = await Promise.all([
    loadImage(list.avatarUrl),
    ...sortWatchingList(animeList)
      .slice(0, PREVIEW_COVERS)
      .map((anime) => loadImage(anime.thumbnailUrl)),
  ]);
  const { headline, detail } = describeList(animeList);

  const image = await draw(
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '52px 60px',
        background: COLORS.page,
        color: COLORS.heading,
      },
      el(
        'div',
        { display: 'flex', alignItems: 'center', gap: 24 },
        avatar
          ? img(avatar, 84, 84, { borderRadius: 42, border: `1px solid ${COLORS.border}` })
          : null,
        el(
          'div',
          { display: 'flex', flexDirection: 'column' },
          el('div', { fontSize: 52, lineHeight: 1.1 }, list.username),
          el('div', { fontSize: 26, color: COLORS.accent }, 'Anime watching list')
        )
      ),
      covers.some(Boolean)
        ? el(
            'div',
            { display: 'flex', gap: 20 },
            ...covers.map((cover) =>
              cover
                ? img(cover, 200, 290, {
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    objectFit: 'cover',
                  })
                : null
            )
          )
        : null,
      el(
        'div',
        { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' },
        el(
          'div',
          { display: 'flex', flexDirection: 'column' },
          el('div', { fontSize: 36, lineHeight: 1.2 }, headline),
          el('div', { fontSize: 24, color: COLORS.accent }, detail)
        ),
        wordmark(40)
      )
    ),
    'jpeg'
  );
  return imageResponse(image, 'jpeg', cacheControl);
}

/** The site's own preview, drawn once per format: it's the same every time */
const sitePreviews = new Map<ImageFormat, Promise<Uint8Array<ArrayBuffer>>>();

/**
 * The site's own preview, also shown for a list that can't be read: private, missing, or busy. It
 * has no photos, so it's sharpest and smallest as a PNG, but takes the format the list's URL says
 */
export async function renderSitePreview(
  cacheControl: string,
  format: ImageFormat = 'png'
): Promise<Response> {
  let image = sitePreviews.get(format);
  if (!image) {
    image = drawSitePreview(format);
    sitePreviews.set(format, image);
    // A failed drawing is tried again next time rather than kept
    image.catch(() => sitePreviews.delete(format));
  }
  return imageResponse(await image, format, cacheControl);
}

function drawSitePreview(format: ImageFormat): Promise<Uint8Array<ArrayBuffer>> {
  return draw(
    el(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 40,
        width: '100%',
        height: '100%',
        padding: '60px 72px',
        background: COLORS.page,
        color: COLORS.heading,
      },
      el(
        'div',
        { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 },
        el('div', { fontSize: 24, color: COLORS.accent }, 'An AniList companion'),
        el('div', { fontSize: 64, lineHeight: 1.1 }, 'Keep up with what you watch.'),
        el(
          'div',
          { fontSize: 28, lineHeight: 1.4, color: COLORS.accent },
          'See what’s aired, keep your progress up to date, and find the shows you’re watching with friends.'
        ),
        el('div', { display: 'flex', marginTop: 12 }, wordmark(44))
      ),
      img(YouSvg, 440, 305)
    ),
    format
  );
}

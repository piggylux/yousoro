import { ImageResponse } from '@vercel/og';
import sharp from 'sharp';

import { getBacklog, getNextUp, sortWatchingList, withoutHiddenMature } from '#lib/anime.js';
import YouSvg from '#lib/images/minimalist_you.svg?inline';
import { describeMatch, joinNames, matchComment } from '#lib/match-words.js';
import { compareTastes, favoriteAnime } from '#lib/match.js';
import { PREVIEW_IMAGE_SIZE, SITE_ORIGIN } from '#lib/seo.js';
import { pickForGroup } from '#lib/together.js';
import type { Anime } from '#lib/types/anime.js';
import type { TasteMatch, TasteProfile } from '#lib/types/match.js';
import type { AnimeYear } from '#lib/types/wrapped.js';
import { summarizeYear } from '#lib/wrapped.js';

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

/** The dark theme's colours from src/app.css, for a badge shown on a dark profile */
const DARK_COLORS: typeof COLORS = {
  page: '#1b1e24',
  border: '#383e49',
  heading: '#eceef2',
  accent: '#acb6c5',
  blue: '#8ab8ef',
};

export type BadgeTheme = 'light' | 'dark';

/** A profile badge is drawn at twice the 600 by 180 it's shown at, to stay sharp on any screen */
export const BADGE_SIZE = { width: 1200, height: 360 } as const;
/** Covers on a badge, of what its owner watched most recently */
const BADGE_COVERS = 5;

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
 * The jokes under a badge's line, one picked for each owner and week (see badgeVariant), so
 * friends' badges read differently and each now and then has a new one. Each fits one line beside
 * five covers, or two under "All caught up.", the one line that never wraps
 */
const QUIPS = {
  idle: ['Taking suggestions.', 'Need a new obsession.', 'What should I start?'],
  rewatching: ['Never gets old.', 'Comfort anime hours.', 'Still hits every time.'],
  finale: ['No spoilers!', 'Tissues at the ready.', 'Not ready to let go.', "Don't spoil it."],
  behind: ['Send snacks.', 'Just one more episode.', "It's a marathon now.", 'Sleep is optional.'],
  almost: ['Almost caught up!', 'Finish line in sight.', 'One sitting, tops.'],
  waiting: ['The wait is the hardest part.', 'Counting down the days.', 'Refreshing every hour.'],
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Which of the jokes someone's badge shows: the same all week, whatever the spelling of their name,
 * then the next one
 */
export function badgeVariant(name: string, now: number): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) % 1_000_003;
  return hash + Math.floor(now / WEEK_MS);
}

/**
 * What a badge says about where its owner is, in their own voice: about to finish a show on the
 * badge, far behind, a few episodes to go, or caught up and waiting. The first that fits wins, so
 * it changes as they watch. Each `line` fits two lines beside five covers; its `quip` is the
 * `variant` of the jokes for it
 */
export function badgeLine(animeList: Anime[], variant = 0): { line: string; quip: string } {
  const pick = (quips: string[]) => quips[variant % quips.length];
  if (!animeList.length) return { line: 'Between shows.', quip: pick(QUIPS.idle) };
  if (animeList.every((anime) => anime.rewatching)) {
    return { line: 'Rewatching an old favorite.', quip: pick(QUIPS.rewatching) };
  }
  // The last episode of a show the badge shows, as one episode doesn't make a finale
  const finale = badgeAnime(animeList).some(
    (anime) =>
      !anime.rewatching &&
      anime.numberEpisodes > 1 &&
      anime.numberEpisodes - anime.currentEpisode === 1
  );
  if (finale) return { line: 'One episode from a finale.', quip: pick(QUIPS.finale) };
  const { episodes } = getBacklog(animeList);
  const count = `${episodes.toLocaleString('en-US')} episode${episodes === 1 ? '' : 's'}`;
  if (episodes >= 10) return { line: `${count} behind.`, quip: pick(QUIPS.behind) };
  if (episodes > 0) return { line: `${count} to go.`, quip: pick(QUIPS.almost) };
  return {
    line: 'All caught up.',
    quip: pick(getNextUp(animeList) ? QUIPS.waiting : QUIPS.idle),
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

function wordmark(fontSize: number, colors = COLORS): Element {
  return el(
    'div',
    { display: 'flex', fontSize, color: colors.heading },
    'Yousoro',
    el('span', { color: colors.blue }, '!')
  );
}

/**
 * Draws the whole image before answering: the renderer otherwise draws it as the response streams,
 * and a failure then cuts the response off instead of reaching the caller. Covers are photos, so a
 * list's preview is a JPEG: as a PNG it is several times larger, too large for some chat apps
 */
async function draw(
  element: Element,
  format: ImageFormat,
  size: { width: number; height: number } = PREVIEW_IMAGE_SIZE
): Promise<Uint8Array<ArrayBuffer>> {
  const png = await new ImageResponse(element as never, size).arrayBuffer();
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
  return renderPersonPreview(
    { name: list.username, avatarUrl: list.avatarUrl, caption: 'Anime watching list' },
    sortWatchingList(animeList).map((anime) => anime.thumbnailUrl),
    describeList(animeList),
    cacheControl
  );
}

/**
 * The preview of a link inviting anyone to compare their anime taste with someone's: covers of
 * the anime they scored highest, adult ones left out
 */
export async function renderMatchInvitePreview(
  profile: TasteProfile,
  cacheControl: string
): Promise<Response> {
  return renderPersonPreview(
    { name: profile.name, avatarUrl: profile.avatarUrl, caption: 'Anime taste match' },
    favoriteAnime(profile).map((anime) => anime.coverUrl),
    {
      headline: 'How well do your tastes match?',
      detail: `Compare your AniList scores with ${profile.name}'s`,
    },
    cacheControl
  );
}

/**
 * Someone's avatar and name at the top, covers in a row, and a headline at the bottom beside the
 * wordmark
 */
async function renderPersonPreview(
  person: { name: string; avatarUrl: string | null; caption: string },
  coverUrls: (string | null)[],
  { headline, detail }: { headline: string; detail: string },
  cacheControl: string
): Promise<Response> {
  const [avatar, ...covers] = await Promise.all([
    loadImage(person.avatarUrl),
    ...coverUrls.slice(0, PREVIEW_COVERS).map(loadImage),
  ]);

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
          el('div', { fontSize: 52, lineHeight: 1.1 }, person.name),
          el('div', { fontSize: 26, color: COLORS.accent }, person.caption)
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

/** What a badge says under a cover: the episode its owner is on, of how many there are */
export function badgeProgress(anime: Anime): string {
  const total = anime.numberEpisodes ? ` / ${anime.numberEpisodes}` : '';
  return `Ep ${anime.currentEpisode}${total}`;
}

/**
 * The anime a badge shows: what its owner watched most recently, leaving out those they haven't
 * started. Adult anime are always left out, as for a visitor who hasn't chosen to see them
 */
export function badgeAnime(animeList: Anime[]): Anime[] {
  return animeList
    .filter((anime) => anime.currentEpisode > 0 && !anime.isAdult)
    .toSorted((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
    .slice(0, BADGE_COVERS);
}

/**
 * A badge for someone to show on their AniList profile, in a README or a forum signature: who they
 * are, where they are with their list in a line of their own, and covers of what they watched most
 * recently with the episode they're on. It names the site, as it's often shown without a link.
 * `list` is null when it can't be read, for a badge of the site alone
 */
export async function renderBadge(
  list: { username: string; avatarUrl: string | null; animeList: Anime[] } | null,
  theme: BadgeTheme,
  cacheControl: string
): Promise<Response> {
  const colors = theme === 'dark' ? DARK_COLORS : COLORS;
  const shown = badgeAnime(list?.animeList ?? []);
  const [avatar, ...covers] = await Promise.all([
    loadImage(list?.avatarUrl ?? null),
    ...shown.map((anime) => loadImage(anime.thumbnailUrl)),
  ]);
  const drawnCovers = shown.flatMap((anime, index) => {
    const cover = covers[index];
    return cover ? [{ cover, progress: badgeProgress(anime) }] : [];
  });
  const host = el('div', { fontSize: 24, color: colors.accent }, new URL(SITE_ORIGIN).host);
  const line = badgeLine(list?.animeList ?? [], badgeVariant(list?.username ?? '', Date.now()));

  const image = await draw(
    el(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        gap: 36,
        width: '100%',
        height: '100%',
        padding: '36px 40px',
        border: `2px solid ${colors.border}`,
        background: colors.page,
        color: colors.heading,
      },
      list
        ? el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 12,
              flex: 1,
              minWidth: 0,
              height: '100%',
            },
            el(
              'div',
              { display: 'flex', alignItems: 'center', gap: 16 },
              avatarOf(list.username, avatar, 64, {
                border: `1px solid ${colors.border}`,
                background: colors.page,
                color: colors.accent,
              }),
              el(
                'div',
                { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
                /*
                 * AniList names are one word of up to 20 letters: a long one is set smaller to fit
                 * the column beside five covers, and breaks if it still doesn't
                 */
                el(
                  'div',
                  {
                    display: 'flex',
                    fontSize: list.username.length > 14 ? 24 : 28,
                    lineHeight: 1.1,
                    wordBreak: 'break-all',
                  },
                  list.username
                ),
                el(
                  'div',
                  { fontSize: 22, color: colors.accent },
                  drawnCovers.length ? 'is watching' : 'on Yousoro'
                )
              )
            ),
            // Large enough to read once a phone shrinks the badge to a third of its size
            el(
              'div',
              { display: 'flex', flexDirection: 'column', gap: 4 },
              el('div', { fontSize: 40, lineHeight: 1.15 }, line.line),
              el('div', { fontSize: 28, lineHeight: 1.2, color: colors.accent }, line.quip)
            ),
            el(
              'div',
              { display: 'flex', alignItems: 'baseline', gap: 14 },
              wordmark(32, colors),
              host
            )
          )
        : el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              flex: 1,
              height: '100%',
            },
            wordmark(48, colors),
            el(
              'div',
              { display: 'flex', flexDirection: 'column' },
              el('div', { fontSize: 36, lineHeight: 1.2 }, 'Keep up with what you watch'),
              el('div', { fontSize: 24, color: colors.accent }, 'An AniList companion')
            ),
            host
          ),
      drawnCovers.length
        ? el(
            'div',
            { display: 'flex', gap: 12 },
            ...drawnCovers.map(({ cover, progress }) =>
              el(
                'div',
                { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
                img(cover, 140, 202, {
                  borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  objectFit: 'cover',
                }),
                el('div', { fontSize: 22, color: colors.accent }, progress)
              )
            )
          )
        : img(YouSvg, 375, 260)
    ),
    'jpeg',
    BADGE_SIZE
  );
  return imageResponse(image, 'jpeg', cacheControl);
}

/**
 * What a match's preview says: how alike the two tastes are, or what they have in common when
 * too few anime were scored by both to tell. `note` stands in for the covers when there are none
 */
export function describeMatchPreview(match: TasteMatch) {
  const inCommon = match.inCommon.toLocaleString('en-US');
  if (match.percent !== null) {
    return {
      headline: `${match.percent}%`,
      detail: describeMatch(match.percent),
      note: `${inCommon} anime in common`,
    };
  }
  return {
    headline: inCommon,
    detail: 'anime in common',
    note: 'Too few scored by both to compare yet',
  };
}

/** Someone's avatar, or their initial without one */
function avatarOf(name: string, avatar: string | null, size: number, style: Style = {}): Element {
  const round = { borderRadius: size / 2, border: `1px solid ${COLORS.border}`, ...style };
  return avatar
    ? img(avatar, size, size, round)
    : el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          background: COLORS.page,
          fontSize: size * 0.45,
          color: COLORS.accent,
          ...round,
        },
        name.charAt(0).toUpperCase()
      );
}

/** A person on a match's preview: their avatar, or their initial without one, over their name */
function person(name: string, avatar: string | null): Element {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: 300 },
    avatarOf(name, avatar, 132),
    // AniList names are one word of up to 20 letters, wider than the column at this size
    el(
      'div',
      {
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        fontSize: 34,
        lineHeight: 1.15,
        textAlign: 'center',
        wordBreak: 'break-all',
      },
      name
    )
  );
}

/**
 * The preview of a match between two people: their avatars either side of how alike their tastes
 * are, and covers of anime both loved. Adult anime are left out, as for a visitor who hasn't
 * chosen to see them
 */
export async function renderMatchPreview(
  a: TasteProfile,
  b: TasteProfile,
  cacheControl: string
): Promise<Response> {
  const match = compareTastes(a, b);
  const [avatarA, avatarB, ...covers] = await Promise.all([
    loadImage(a.avatarUrl),
    loadImage(b.avatarUrl),
    ...match.bothLoved.slice(0, PREVIEW_COVERS).map(({ anime }) => loadImage(anime.coverUrl)),
  ]);
  const { headline, detail, note } = describeMatchPreview(match);
  const shownCovers = covers.filter((cover) => cover !== null);

  const image = await draw(
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '44px 60px',
        background: COLORS.page,
        color: COLORS.heading,
      },
      el(
        'div',
        { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        person(a.name, avatarA),
        el(
          'div',
          { display: 'flex', flexDirection: 'column', alignItems: 'center' },
          el('div', { fontSize: 26, color: COLORS.accent }, 'Anime taste match'),
          el('div', { fontSize: 128, lineHeight: 1.05 }, headline),
          el('div', { fontSize: 34, color: COLORS.accent }, detail)
        ),
        person(b.name, avatarB)
      ),
      // The page's joke, about them, as the link is shared beyond the two of them
      match.percent !== null
        ? el(
            'div',
            {
              display: 'flex',
              justifyContent: 'center',
              textAlign: 'center',
              fontSize: 28,
              color: COLORS.heading,
            },
            matchComment(match.percent, a, b, false)
          )
        : null,
      el(
        'div',
        { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' },
        shownCovers.length
          ? el(
              'div',
              { display: 'flex', flexDirection: 'column', gap: 10 },
              el('div', { fontSize: 24, color: COLORS.accent }, 'Both loved'),
              el(
                'div',
                { display: 'flex', gap: 14 },
                ...shownCovers.map((cover) =>
                  img(cover, 136, 196, {
                    borderRadius: 10,
                    border: `1px solid ${COLORS.border}`,
                    objectFit: 'cover',
                  })
                )
              )
            )
          : el('div', { fontSize: 28, color: COLORS.accent }, note),
        wordmark(40)
      )
    ),
    'jpeg'
  );
  return imageResponse(image, 'jpeg', cacheControl);
}

/**
 * The preview of a group picking an anime to watch together: everyone's avatars over who they are,
 * and covers of their top picks. A group of one is an invitation to join, with covers of its host's
 * favorites. Adult anime are left out, as for a visitor who hasn't chosen to see them
 */
export async function renderGroupPreview(
  profiles: TasteProfile[],
  cacheControl: string
): Promise<Response> {
  const [host] = profiles;
  if (profiles.length === 1) {
    return renderPersonPreview(
      { name: host.name, avatarUrl: host.avatarUrl, caption: 'Watch together' },
      favoriteAnime(host).map((anime) => anime.coverUrl),
      {
        headline: 'What should we watch together?',
        detail: `Join ${host.name}'s group to find an anime you'll all enjoy`,
      },
      cacheControl
    );
  }
  const picks = pickForGroup(profiles);
  const [avatars, covers] = await Promise.all([
    Promise.all(profiles.map((profile) => loadImage(profile.avatarUrl))),
    Promise.all(picks.slice(0, PREVIEW_COVERS).map(({ anime }) => loadImage(anime.coverUrl))),
  ]);
  const shownCovers = covers.filter((cover) => cover !== null);

  const image = await draw(
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '44px 60px',
        background: COLORS.page,
        color: COLORS.heading,
      },
      el(
        'div',
        { display: 'flex', flexDirection: 'column', gap: 18 },
        el(
          'div',
          { display: 'flex' },
          ...profiles.map((profile, index) =>
            avatarOf(profile.name, avatars[index], 92, {
              marginLeft: index ? -14 : 0,
              border: `3px solid ${COLORS.page}`,
            })
          )
        ),
        el('div', { fontSize: 26, color: COLORS.accent }, 'Watch together'),
        // AniList names are one word of up to 20 letters, so six of them can take two lines
        el(
          'div',
          { display: 'flex', fontSize: 44, lineHeight: 1.15, wordBreak: 'break-word' },
          `What should ${joinNames(profiles.map((profile) => profile.name))} watch?`
        )
      ),
      el(
        'div',
        { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' },
        shownCovers.length
          ? el(
              'div',
              { display: 'flex', flexDirection: 'column', gap: 10 },
              el('div', { fontSize: 24, color: COLORS.accent }, 'Top picks'),
              el(
                'div',
                { display: 'flex', gap: 14 },
                ...shownCovers.map((cover) =>
                  img(cover, 120, 172, {
                    borderRadius: 10,
                    border: `1px solid ${COLORS.border}`,
                    objectFit: 'cover',
                  })
                )
              )
            )
          : el('div', { fontSize: 28, color: COLORS.accent }, 'Nothing fits everyone yet'),
        wordmark(40)
      )
    ),
    'jpeg'
  );
  return imageResponse(image, 'jpeg', cacheControl);
}

/**
 * The preview of someone's year in anime: how much they finished, their favorite genres, and covers
 * of what they scored highest. Adult anime are left out, as for a visitor who hasn't chosen to see
 * them
 */
export async function renderWrappedPreview(
  animeYear: AnimeYear,
  cacheControl: string
): Promise<Response> {
  const summary = summarizeYear(animeYear);
  const genres = summary.topGenres.map(({ genre }) => genre);
  return renderPersonPreview(
    { name: animeYear.name, avatarUrl: animeYear.avatarUrl, caption: `${animeYear.year} in anime` },
    summary.favorites.map((anime) => anime.coverUrl),
    summary.finished
      ? {
          headline: `${summary.finished.toLocaleString('en-US')} anime finished · ${summary.hours.toLocaleString('en-US')} hours`,
          detail: genres.length ? `Mostly ${joinNames(genres)}` : 'An AniList year in anime',
        }
      : {
          headline: `No anime finished in ${animeYear.year} yet`,
          detail: 'An AniList year in anime',
        },
    cacheControl
  );
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

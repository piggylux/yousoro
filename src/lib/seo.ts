import { joinNames } from '#lib/match-words.js';
import { matchPath } from '#lib/match.js';
import { togetherPath } from '#lib/together.js';

export const SITE_ORIGIN = 'https://yousoro.vercel.app';
export const SITE_NAME = 'Yousoro';
export const HOME_TITLE = 'Yousoro | Anime Tracker & AniList Episode Calendar';
export const SITE_DESCRIPTION =
  'Track your AniList anime watching list, catch up on aired episodes, and plan your next watch with an episode calendar. Keep your anime on course with Yousoro.';

/** Link previews are drawn at the size social sites show large, by src/lib/server/preview-image.ts */
export const PREVIEW_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The site's own link preview, for pages that don't draw one of their own */
export const SHARE_IMAGE = `${SITE_ORIGIN}/preview.png`;
const SHARE_IMAGE_ALT = 'Yousoro: keep up with what you watch';

/** The link preview of a list, drawn from its public AniList entries */
export function listPreviewImage(username: string): string {
  return `${SITE_ORIGIN}/user/anilist/${encodeURIComponent(username)}/preview.jpg`;
}

/** The link preview of a group picking an anime, or of an invitation to join `username` alone */
export function groupPreviewImage(username: string, others: string[]): string {
  return `${SITE_ORIGIN}${togetherPath(username, others)}/preview.jpg`;
}

/** The link preview of a taste match, or of an invitation to compare with `username` alone */
export function matchPreviewImage(username: string, other?: string): string {
  return `${SITE_ORIGIN}${matchPath(username, other)}/preview.jpg`;
}

type SeoUrl = Pick<URL, 'pathname' | 'origin'> & {
  searchParams: Pick<URLSearchParams, 'get'>;
};

export function getPageSeo(url: SeoUrl, status = 200, resolvedUsername?: string) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  let title = SITE_NAME;
  let description = SITE_DESCRIPTION;
  let canonical: string | undefined;
  let image = { url: SHARE_IMAGE, type: 'image/png', alt: SHARE_IMAGE_ALT };
  const home = path === '/home';
  const taste = path.match(/^\/user\/anilist\/([^/]+)\/match(?:\/([^/]+))?$/);
  const group = path.match(/^\/user\/anilist\/([^/]+)\/together((?:\/[^/]+)*)$/);
  // The names in the path of a group, its host's first
  let names: string[] = [];
  try {
    if (group) names = [group[1], ...group[2].split('/').slice(1)].map(decodeURIComponent);
  } catch {
    return { title, description, canonical, image, noindex: true, home: false };
  }
  if (status >= 400) title = `${status} | ${SITE_NAME}`;
  else if (home) {
    title = HOME_TITLE;
    canonical = `${SITE_ORIGIN}/home`;
  } else if (path === '/settings') title = `Settings | ${SITE_NAME}`;
  else if (path.startsWith('/auth/')) title = `Signing in | ${SITE_NAME}`;
  else if (group) {
    // Groups are picked in the browser and never indexed, but their links are shared
    const [host, ...others] = names;
    if (others.length) {
      const everyone = joinNames(names);
      title = `What Should ${everyone} Watch Together? | ${SITE_NAME}`;
      description = `Anime for ${everyone} to start together, picked from their AniList scores and plan lists.`;
      image = {
        url: groupPreviewImage(host, others),
        type: 'image/jpeg',
        alt: `What ${everyone} could watch together`,
      };
    } else {
      title = `Pick an Anime to Watch with ${host} | ${SITE_NAME}`;
      description = `Join ${host}'s group to find an anime you'll all enjoy, from your AniList scores and plan lists.`;
      image = {
        url: groupPreviewImage(host, []),
        type: 'image/jpeg',
        alt: `Pick an anime to watch with ${host}`,
      };
    }
  } else if (taste) {
    // Comparisons are drawn in the browser and never indexed, but their links are shared
    let a: string;
    let b: string | undefined;
    try {
      [a, b] = taste.slice(1).map((name) => name && decodeURIComponent(name));
    } catch {
      return { title, description, canonical, image, noindex: true, home: false };
    }
    if (b) {
      title = `${a} × ${b}: Anime Taste Match | ${SITE_NAME}`;
      description = `How alike are ${a} and ${b}'s anime tastes? See the anime they both loved, where they disagree, and what each should watch next.`;
      image = {
        url: matchPreviewImage(a, b),
        type: 'image/jpeg',
        alt: `How ${a} and ${b}'s anime tastes match`,
      };
    } else {
      title = `Compare Your Anime Taste with ${a} | ${SITE_NAME}`;
      description = `See how your AniList scores match ${a}'s: the anime you both loved, where you disagree, and what to watch next.`;
      image = {
        url: matchPreviewImage(a),
        type: 'image/jpeg',
        alt: `Compare your anime taste with ${a}`,
      };
    }
  } else {
    const match = path.match(/^\/user\/anilist\/([^/]+)(\/friends)?$/);
    if (match) {
      let username: string;
      try {
        username = decodeURIComponent(match[1]);
      } catch {
        return { title, description, canonical, image, noindex: true, home: false };
      }
      // AniList returns its canonical spelling even when the requested name uses another case.
      username = resolvedUsername || username;
      if (match[2]) {
        title = `${username}'s friends | ${SITE_NAME}`;
        description = `The people ${username} follows on AniList.`;
      } else {
        const calendar = url.searchParams.get('view') === 'calendar';
        title = `${username}'s ${calendar ? 'Anime Episode Calendar' : 'Anime Watching List'} | ${SITE_NAME}`;
        description = `Explore ${username}'s AniList watching list on Yousoro. See aired anime episodes, catch-up progress, and upcoming release dates.`;
        // The calendar and filtered views are alternate presentations of this public list.
        canonical = `${SITE_ORIGIN}/user/anilist/${encodeURIComponent(username)}`;
        image = {
          url: listPreviewImage(username),
          type: 'image/jpeg',
          alt: `${username}'s anime watching list`,
        };
      }
    }
  }
  return {
    title,
    description,
    canonical,
    image,
    noindex: !canonical || status !== 200 || url.origin !== SITE_ORIGIN,
    home: home && status === 200,
  };
}

export const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  alternateName: 'ヨーソロー',
  url: `${SITE_ORIGIN}/`,
  description: SITE_DESCRIPTION,
  inLanguage: 'en',
};

/** JSON-LD is raw script text; a literal less-than sign must never close its script element. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function jsonLdScript(data: object): string {
  return `<script type="application/ld+json">${serializeJsonLd(data)}</script>`;
}

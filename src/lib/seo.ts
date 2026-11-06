import { joinNames, serviceNames } from '#lib/match-words.js';
import { matchPath, parsePersonSegment } from '#lib/match.js';
import { togetherPath } from '#lib/together.js';
import { DOMAIN_NAMES, listPath, type Domain, type ListOwner } from '#lib/types/domain.js';
import { wrappedPath } from '#lib/wrapped.js';

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

/** The link preview of a list, drawn from its public entries */
export function listPreviewImage(username: string, domain: Domain = 'anilist'): string {
  return `${SITE_ORIGIN}${listPath(domain, username)}/preview.jpg`;
}

/** A profile badge of a list, as badge.jpg draws it, for light or dark pages */
export function badgePath(owner: ListOwner, theme: 'light' | 'dark'): string {
  const path = `${listPath(owner.domain, owner.name)}/badge.jpg`;
  return theme === 'dark' ? `${path}?theme=dark` : path;
}

/** The link preview of a group picking an anime, or of an invitation to join `host` alone */
export function groupPreviewImage(host: ListOwner, others: ListOwner[]): string {
  return `${SITE_ORIGIN}${togetherPath(host, others)}/preview.jpg`;
}

/** The link preview of someone's year in anime */
export function wrappedPreviewImage(username: string, year: number): string {
  return `${SITE_ORIGIN}${wrappedPath(username, year)}/preview.jpg`;
}

/** The link preview of a taste match, or of an invitation to compare with `owner` alone */
export function matchPreviewImage(owner: ListOwner, other?: ListOwner): string {
  return `${SITE_ORIGIN}${matchPath(owner, other)}/preview.jpg`;
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
  const taste = path.match(/^\/user\/(anilist|myanimelist)\/([^/]+)\/match(\/[^/]+)?$/);
  const group = path.match(/^\/user\/(anilist|myanimelist)\/([^/]+)\/together((?:\/[^/]+)*)$/);
  const wrapped = path.match(/^\/user\/anilist\/([^/]+)\/wrapped\/(\d{4})$/);
  const badge = path.match(/^\/user\/(anilist|myanimelist)\/([^/]+)\/badge$/);
  /*
   * The people in the path of a match, a group or a badge, its owner's first, each on the owner's
   * service unless their segment names the other; leaving out segments that name nobody
   */
  const owned = taste ?? group ?? badge;
  let people: ListOwner[] = [];
  let wrappedName = '';
  try {
    if (owned) {
      const domain = owned[1] as Domain;
      const segments = (owned[3] ?? '').split('/').slice(1).map(decodeURIComponent);
      people = [
        { domain, name: decodeURIComponent(owned[2]) },
        ...segments.flatMap((segment) => parsePersonSegment(segment, domain) ?? []),
      ];
    } else if (wrapped) wrappedName = decodeURIComponent(wrapped[1]);
  } catch {
    return { title, description, canonical, image, noindex: true, home: false };
  }
  const names = people.map(({ name }) => name);
  if (status >= 400) title = `${status} | ${SITE_NAME}`;
  else if (home) {
    title = HOME_TITLE;
    canonical = `${SITE_ORIGIN}/home`;
  } else if (path === '/settings') title = `Settings | ${SITE_NAME}`;
  else if (path === '/sync') title = `Sync Your Lists | ${SITE_NAME}`;
  else if (path.startsWith('/auth/')) title = `Signing in | ${SITE_NAME}`;
  else if (group) {
    // Groups are picked in the browser and never indexed, but their links are shared
    const [host, ...others] = people;
    if (others.length) {
      const everyone = joinNames(names);
      title = `What Should ${everyone} Watch Together? | ${SITE_NAME}`;
      description = `Anime none of ${everyone} have seen yet, picked from their ${serviceNames(people)} plan lists.`;
      image = {
        url: groupPreviewImage(host, others),
        type: 'image/jpeg',
        alt: `What ${everyone} could watch together`,
      };
    } else {
      title = `Pick an Anime to Watch with ${host.name} | ${SITE_NAME}`;
      description = `Join ${host.name}'s group to find an anime none of you have seen, from your plan lists.`;
      image = {
        url: groupPreviewImage(host, []),
        type: 'image/jpeg',
        alt: `Pick an anime to watch with ${host.name}`,
      };
    }
  } else if (wrapped) {
    const name = wrappedName;
    const year = Number(wrapped[2]);
    title = `${name}'s ${year} in Anime | ${SITE_NAME}`;
    description = `The anime ${name} finished in ${year}: hours watched, top genres, favorites, and their hottest take.`;
    image = {
      url: wrappedPreviewImage(name, year),
      type: 'image/jpeg',
      alt: `${name}'s ${year} in anime`,
    };
  } else if (badge) {
    const [owner] = people;
    const service = DOMAIN_NAMES[owner.domain];
    title = `${owner.name}'s Profile Badge | ${SITE_NAME}`;
    description = `Show what ${owner.name} is watching on ${service === 'AniList' ? 'an' : 'a'} ${service} profile, in a README, or anywhere that shows images.`;
  } else if (taste) {
    // Comparisons are drawn in the browser and never indexed, but their links are shared
    const [a, b] = people;
    if (b) {
      title = `${a.name} × ${b.name}: Anime Taste Match | ${SITE_NAME}`;
      description = `How alike are ${a.name} and ${b.name}'s anime tastes? See the anime they both loved, where they disagree, and what each should watch next.`;
      image = {
        url: matchPreviewImage(a, b),
        type: 'image/jpeg',
        alt: `How ${a.name} and ${b.name}'s anime tastes match`,
      };
    } else {
      title = `Compare Your Anime Taste with ${a.name} | ${SITE_NAME}`;
      description = `See how your anime scores match ${a.name}'s: the anime you both loved, where you disagree, and what to watch next.`;
      image = {
        url: matchPreviewImage(a),
        type: 'image/jpeg',
        alt: `Compare your anime taste with ${a.name}`,
      };
    }
  } else {
    // Friends are AniList's only; plan lists are on both services
    const match = path.match(/^\/user\/(?:(anilist)|myanimelist)\/([^/]+)(\/friends|\/planning)?$/);
    if (match && (match[1] || match[3] !== '/friends')) {
      const domain: Domain = match[1] ? 'anilist' : 'myanimelist';
      let username: string;
      try {
        username = decodeURIComponent(match[2]);
      } catch {
        return { title, description, canonical, image, noindex: true, home: false };
      }
      // AniList returns its canonical spelling even when the requested name uses another case.
      username = resolvedUsername || username;
      if (match[3] === '/friends') {
        title = `${username}'s friends | ${SITE_NAME}`;
        description = `The people ${username} follows on AniList.`;
      } else if (match[3]) {
        title = `${username}'s Planning List | ${SITE_NAME}`;
        description = `The anime ${username} plans to watch on ${DOMAIN_NAMES[domain]}.`;
      } else {
        const calendar = url.searchParams.get('view') === 'calendar';
        title = `${username}'s ${calendar ? 'Anime Episode Calendar' : 'Anime Watching List'} | ${SITE_NAME}`;
        description = `Explore ${username}'s ${DOMAIN_NAMES[domain]} watching list on Yousoro. See aired anime episodes, catch-up progress, and upcoming release dates.`;
        // MyAnimeList names ignore case, and its public lists don't say how their owner spells it
        const canonicalName = domain === 'myanimelist' ? username.toLowerCase() : username;
        // The calendar and filtered views are alternate presentations of this public list.
        canonical = `${SITE_ORIGIN}${listPath(domain, canonicalName)}`;
        image = {
          url: listPreviewImage(canonicalName, domain),
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

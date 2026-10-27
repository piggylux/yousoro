export const SITE_ORIGIN = 'https://yousoro.vercel.app';
export const SITE_NAME = 'Yousoro';
export const HOME_TITLE = 'Yousoro | Anime Tracker & AniList Episode Calendar';
export const SITE_DESCRIPTION =
  'Track your AniList anime watching list, catch up on aired episodes, and plan your next watch with an episode calendar. Keep your anime on course with Yousoro.';
export const SHARE_IMAGE = `${SITE_ORIGIN}/android-chrome-512x512.png`;

type SeoUrl = Pick<URL, 'pathname' | 'origin'> & {
  searchParams: Pick<URLSearchParams, 'get'>;
};

export function getPageSeo(url: SeoUrl, status = 200, resolvedUsername?: string) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  let title = SITE_NAME;
  let description = SITE_DESCRIPTION;
  let canonical: string | undefined;
  const home = path === '/home';
  if (status >= 400) title = `${status} | ${SITE_NAME}`;
  else if (home) {
    title = HOME_TITLE;
    canonical = `${SITE_ORIGIN}/home`;
  } else if (path === '/settings') title = `Settings | ${SITE_NAME}`;
  else if (path.startsWith('/auth/')) title = `Signing in | ${SITE_NAME}`;
  else {
    const match = path.match(/^\/user\/anilist\/([^/]+)(\/friends)?$/);
    if (match) {
      let username: string;
      try {
        username = decodeURIComponent(match[1]);
      } catch {
        return { title, description, canonical, noindex: true, home: false };
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
      }
    }
  }
  return {
    title,
    description,
    canonical,
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

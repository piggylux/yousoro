const DOMAIN_VALUES = ['anilist', 'myanimelist'] as const;
export type Domain = (typeof DOMAIN_VALUES)[number];

export function isDomain(value: string): value is Domain {
  return DOMAIN_VALUES.includes(value as never);
}

/** How each service is named to people */
export const DOMAIN_NAMES: Record<Domain, string> = {
  anilist: 'AniList',
  myanimelist: 'MyAnimeList',
};

/** Where someone's list is on this site */
export function listPath(domain: Domain, username: string): string {
  return `/user/${domain}/${encodeURIComponent(username)}`;
}

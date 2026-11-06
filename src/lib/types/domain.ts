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

/** Someone's profile on a service */
export function profileUrl(domain: Domain, username: string): string {
  return domain === 'anilist'
    ? `https://anilist.co/user/${encodeURIComponent(username)}/`
    : `https://myanimelist.net/profile/${encodeURIComponent(username)}`;
}

/** An anime's page on the list's own service: MyAnimeList's when the list is there and knows it */
export function animePageUrl(
  domain: Domain,
  { id, malId }: { id: number | null; malId: number | null }
): string {
  return domain === 'myanimelist' && malId !== null
    ? `https://myanimelist.net/anime/${malId}`
    : `https://anilist.co/anime/${id}`;
}

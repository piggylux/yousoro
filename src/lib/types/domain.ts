// MyAnimeList support was removed for now; it can come back as another domain
const DOMAIN_VALUES = ['anilist'] as const;
export type Domain = (typeof DOMAIN_VALUES)[number];

export function isDomain(value: string): value is Domain {
  return DOMAIN_VALUES.includes(value as never);
}

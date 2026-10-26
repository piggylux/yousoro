/** The language of the releases the nyaa.si download search looks for */
export const DOWNLOAD_LANGUAGES = ['any', 'english', 'french'] as const;
export type DownloadLanguage = (typeof DOWNLOAD_LANGUAGES)[number];

/** How those releases are translated: subtitles, a dub, or both audio tracks */
export const DOWNLOAD_VERSIONS = ['any', 'subbed', 'dubbed', 'dual-audio'] as const;
export type DownloadVersion = (typeof DOWNLOAD_VERSIONS)[number];

/** How big the anime cards are: smaller cards fit more per row */
export const CARD_SIZES = ['small', 'medium', 'large'] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

export function isCardSize(value: unknown): value is CardSize {
  return CARD_SIZES.includes(value as CardSize);
}

export function isDownloadLanguage(value: unknown): value is DownloadLanguage {
  return DOWNLOAD_LANGUAGES.includes(value as DownloadLanguage);
}

export function isDownloadVersion(value: unknown): value is DownloadVersion {
  return DOWNLOAD_VERSIONS.includes(value as DownloadVersion);
}

/** Display settings a visitor picks on the settings page, remembered in their browser. */
export type Preferences = {
  theme: Theme;
  /** List anime AniList marks as adult (18+); when off, they're left out of every list */
  showMature: boolean;
  /** Blur covers of anime AniList marks as adult, when they're shown */
  blurMature: boolean;
  /** How big the anime cards are, and so how many fit in a row */
  cardSize: CardSize;
  /** The language the download search on the viewer's own list looks for */
  downloadLanguage: DownloadLanguage;
  /** Subbed, dubbed or dual-audio releases, for the same search */
  downloadVersion: DownloadVersion;
};

/** What a visitor gets before choosing anything: the safe choice for lists others may see */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  showMature: false,
  blurMature: true,
  cardSize: 'medium',
  downloadLanguage: 'any',
  downloadVersion: 'any',
};

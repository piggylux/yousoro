/** The language of the releases the nyaa.si download search looks for */
export const DOWNLOAD_LANGUAGES = ['any', 'english', 'french'] as const;
export type DownloadLanguage = (typeof DOWNLOAD_LANGUAGES)[number];

/** How those releases are translated: subtitles, a dub, or both audio tracks */
export const DOWNLOAD_VERSIONS = ['any', 'subbed', 'dubbed', 'dual-audio'] as const;
export type DownloadVersion = (typeof DOWNLOAD_VERSIONS)[number];

export function isDownloadLanguage(value: unknown): value is DownloadLanguage {
  return DOWNLOAD_LANGUAGES.includes(value as DownloadLanguage);
}

export function isDownloadVersion(value: unknown): value is DownloadVersion {
  return DOWNLOAD_VERSIONS.includes(value as DownloadVersion);
}

/** Display settings a visitor picks on the settings page, remembered in their browser. */
export type Preferences = {
  /** Blur covers of anime AniList marks as adult (18+) */
  blurMature: boolean;
  /** The language the download search on the viewer's own list looks for */
  downloadLanguage: DownloadLanguage;
  /** Subbed, dubbed or dual-audio releases, for the same search */
  downloadVersion: DownloadVersion;
};

/** What a visitor gets before choosing anything: the safe choice for lists others may see */
export const DEFAULT_PREFERENCES: Preferences = {
  blurMature: true,
  downloadLanguage: 'any',
  downloadVersion: 'any',
};

/** Display settings a visitor picks on the settings page, remembered in their browser. */
export type Preferences = {
  /** Blur covers of anime AniList marks as adult (18+) */
  blurMature: boolean;
};

/** What a visitor gets before choosing anything: the safe choice for lists others may see */
export const DEFAULT_PREFERENCES: Preferences = { blurMature: true };

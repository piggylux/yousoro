import { isListSection, LIST_SECTIONS, type ListSection } from '#lib/anime.js';

/*
 * The sections of a list the viewer hides with the filters above it, such as caught-up anime. The
 * page writes the cookie itself, so a filter applies at once with no request, and the server reads
 * it to render the list already filtered on the next visit
 */
export const HIDDEN_SECTIONS_COOKIE = 'hidden-sections';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The hidden sections a cookie lists: known ones only, each once, in the list's order */
export function parseHiddenSections(value: string | undefined): ListSection[] {
  const listed = (value ?? '').split(',').filter(isListSection);
  return LIST_SECTIONS.filter((section) => listed.includes(section));
}

/** The hidden sections remembered in the browser, from all its cookies as `document.cookie` gives them */
export function hiddenSectionsInBrowser(documentCookie: string): ListSection[] {
  const prefix = `${HIDDEN_SECTIONS_COOKIE}=`;
  const cookie = documentCookie.split('; ').find((entry) => entry.startsWith(prefix));
  return parseHiddenSections(cookie && decodeURIComponent(cookie.slice(prefix.length)));
}

/** The hidden sections once one is toggled: shown again if it was hidden, hidden otherwise */
export function toggleHidden(hidden: ListSection[], section: ListSection): ListSection[] {
  return hidden.includes(section)
    ? hidden.filter((other) => other !== section)
    : LIST_SECTIONS.filter((other) => other === section || hidden.includes(other));
}

/** The cookie that remembers the hidden sections, as `document.cookie` takes it */
export function hiddenSectionsCookie(hidden: ListSection[]): string {
  return `${HIDDEN_SECTIONS_COOKIE}=${hidden.join(',')}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

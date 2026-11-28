/** The pages that wait on AniList or MyAnimeList before they show, and so have a skeleton */
export type SkeletonKind = 'list' | 'calendar' | 'planning' | 'friends' | 'sync';

/** Where a navigation starts or ends, as SvelteKit describes it */
type Place = { url: URL; route: { id: string | null } };

/** A navigation under way, as SvelteKit's `navigating` describes it */
type Navigation = { from: Place | null; to: Place | null; type: string | null };

/**
 * How long a navigation runs before its skeleton shows. A list kept from earlier in the tab
 * arrives sooner, and shows without a skeleton flashing up first
 */
export const SKELETON_AFTER_MS = 150;

/** What screen readers hear while each skeleton shows */
export const SKELETON_LABELS: Record<SkeletonKind, string> = {
  list: 'Loading the anime list…',
  calendar: 'Loading the episode calendar…',
  planning: 'Loading the planning list…',
  friends: 'Loading friends…',
  sync: 'Loading both lists…',
};

/**
 * Whether a list is the viewer's own, on the account they're signed in with there. Their own has
 * more buttons, so its skeleton does too
 */
export function ownsList(
  list: { domain?: string; username?: string },
  accounts: { user?: { name: string } | null; malUser?: { name: string } | null }
): boolean {
  const account =
    list.domain === 'anilist'
      ? accounts.user
      : list.domain === 'myanimelist'
        ? accounts.malUser
        : null;
  return !!account && account.name.toLowerCase() === list.username?.toLowerCase();
}

/**
 * The skeleton to show while a navigation loads, in the shape of the page it's going to; null for
 * the pages that show at once. Showing the same page again, as a retry does, keeps what's on screen
 * until the new answer arrives, and so does a form sent without script
 */
export function skeletonFor({ from, to, type }: Navigation): SkeletonKind | null {
  if (!to || type === 'form' || type === 'enter') return null;
  if (from && from.url.pathname === to.url.pathname && from.url.search === to.url.search) {
    return null;
  }
  switch (to.route.id) {
    case '/user/[domain]/[username]':
      return to.url.searchParams.get('view') === 'calendar' ? 'calendar' : 'list';
    case '/user/[domain]/[username]/planning':
      return 'planning';
    case '/user/[domain]/[username]/friends':
      return 'friends';
    case '/sync':
      return 'sync';
    default:
      return null;
  }
}

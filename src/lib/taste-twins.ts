import { compareTastes, loadTasteProfile, MIN_BOTH_SCORED } from '#lib/match.js';

type Person = { id: number; name: string; avatarUrl: string | null };

/** How someone's taste compares with a friend's */
export type TwinResult = Person & {
  /** How alike their scores are, as a match's percent; null when it can't be told */
  percent: number | null;
  /** How many anime both have scored, which `percent` is drawn from */
  bothScored: number;
  /** The friend's list isn't public */
  private: boolean;
};

/** How a round of comparisons stopped. `busy` can be resumed with the friends not compared yet */
export type TwinOutcome =
  | { status: 'done' }
  | { status: 'busy'; retryAt: number }
  | { status: 'failed' }
  /** The owner's own list isn't public, so there's nothing to compare with */
  | { status: 'private' }
  /** The owner has scored too few anime for any match, so no friend's list is read */
  | { status: 'unscored'; scored: number };

/**
 * Compares `owner`'s taste with each friend's, a few at a time so the profiles the CDN keeps come
 * back quickly while AniList is asked for only a few others at once. Each friend's result is
 * passed on as it comes. Stops when AniList is busy or fails, before any friend's read when the
 * owner's own scores can't make a match, and resolves with null once `active` says nobody is
 * waiting for it any more
 */
export async function compareWithFriends(
  owner: string,
  friends: Person[],
  onResult: (result: TwinResult) => void,
  {
    load = loadTasteProfile,
    parallel = 3,
    active = () => true,
  }: { load?: typeof loadTasteProfile; parallel?: number; active?: () => boolean } = {}
): Promise<TwinOutcome | null> {
  const own = await load(owner);
  if (!active()) return null;
  if (own.status === 'missing') return { status: 'private' };
  if (own.status === 'busy') return own;
  if (own.status !== 'ready') return { status: 'failed' };
  const scored = own.profile.scored.length;
  if (scored < MIN_BOTH_SCORED) return { status: 'unscored', scored };

  for (let start = 0; start < friends.length; start += parallel) {
    const batch = friends.slice(start, start + parallel);
    const states = await Promise.all(batch.map((friend) => load(friend.name)));
    if (!active()) return null;
    // The latest wait, so the next round doesn't start before AniList is ready again
    let retryAt = 0;
    let failed = false;
    for (const [index, friend] of batch.entries()) {
      const state = states[index];
      if (state.status === 'ready') {
        const { percent, bothScored } = compareTastes(own.profile, state.profile);
        onResult({ ...friend, percent, bothScored, private: false });
      } else if (state.status === 'missing') {
        onResult({ ...friend, percent: null, bothScored: 0, private: true });
      } else if (state.status === 'busy') retryAt = Math.max(retryAt, state.retryAt);
      else failed = true;
    }
    if (retryAt) return { status: 'busy', retryAt };
    if (failed) return { status: 'failed' };
  }
  return { status: 'done' };
}

/** Friends with a match, the closest first; among equals, those with more anime scored by both */
export function rankTwins(results: TwinResult[]): (TwinResult & { percent: number })[] {
  return results
    .filter((result): result is TwinResult & { percent: number } => result.percent !== null)
    .toSorted(
      (a, b) => b.percent - a.percent || b.bothScored - a.bothScored || a.name.localeCompare(b.name)
    );
}

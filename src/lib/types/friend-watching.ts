export type FriendWatching = {
  id: number;
  name: string;
  avatarUrl: string | null;
  progress: number;
  rewatching: boolean;
  /** The signed-in viewer, included when comparing with someone else's list. */
  isViewer?: boolean;
};

export type FriendWatchingResult = {
  retryAfter?: number;
  matches: Record<number, FriendWatching[]>;
  partial: boolean;
};

export type FriendsLookupState =
  | { status: 'loading' }
  | { status: 'ready'; result: FriendWatchingResult }
  | { status: 'unavailable'; message: string; retryAt: number };

export type SharedAnime = { id: number; title: string; isAdult: boolean; coverUrl?: string | null };

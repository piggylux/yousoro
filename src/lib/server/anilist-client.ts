import type { AiringStatus } from '#lib/types/anime.js';

const ANILIST_URL = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
  id
  title { romaji }
  status
  episodes
  coverImage { extraLarge }
  endDate { year month day }
  nextAiringEpisode { episode airingAt }
  isAdult
`;

export type AniListMedia = {
  id: number;
  title: { romaji: string };
  status: AiringStatus;
  episodes: number | null;
  coverImage: { extraLarge: string };
  endDate: { year: number | null; month: number | null; day: number | null };
  /** `airingAt` is Unix time in seconds */
  nextAiringEpisode: { episode: number; airingAt: number } | null;
  /** AniList's flag for adult (18+) titles */
  isAdult: boolean;
};

export type AniListEntry = {
  /** CURRENT is "Watching"; REPEATING is "Rewatching" */
  status: 'CURRENT' | 'REPEATING';
  progress: number;
  /** Unix time in seconds of the last change to the entry, or 0 when AniList doesn't know */
  updatedAt: number;
  media: AniListMedia;
};

type GraphQLResponse<T> = {
  data: T | null;
  errors?: { message: string; status?: number }[];
};

/** Thrown when AniList rejects the access token, e.g. once a user's token has expired. */
export class AniListTokenError extends Error {}

/** Thrown when AniList has no user by the requested name. */
export class AniListNotFoundError extends Error {}

/**
 * Sends a query as the given user, or anonymously when there is no token. Public data needs no
 * token, so the app never holds credentials of its own.
 */
async function query<T>(
  query: string,
  variables: Record<string, unknown>,
  token?: string
): Promise<T> {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body: GraphQLResponse<T> = await response.json();

  if (!response.ok || body.errors || !body.data) {
    const messages = body.errors?.map((error) => error.message).join(', ') ?? response.statusText;
    if (body.errors?.some((error) => error.message === 'Invalid token')) {
      throw new AniListTokenError(messages);
    }
    if (body.errors?.some((error) => error.status === 404)) {
      throw new AniListNotFoundError(messages);
    }
    throw new Error(`AniList API returned ${response.status}: ${messages}`);
  }

  return body.data;
}

/** Fetches a user's "Watching" and "Rewatching" lists, media details included, in one request. */
export async function getWatchingEntries(
  userName: string,
  token?: string
): Promise<{
  userId: number;
  userName: string;
  avatarUrl: string | null;
  entries: AniListEntry[];
}> {
  const data = await query<{
    MediaListCollection: {
      user: { id: number; name: string; avatar: { large: string | null } | null };
      lists: { isCustomList: boolean; entries: AniListEntry[] }[];
    };
  }>(
    `query ($userName: String) {
      MediaListCollection(userName: $userName, type: ANIME, status_in: [CURRENT, REPEATING]) {
        user { id name avatar { large } }
        lists { isCustomList entries { status progress updatedAt media { ${MEDIA_FIELDS} } } }
      }
    }`,
    { userName },
    token
  );

  return {
    userId: data.MediaListCollection.user.id,
    userName: data.MediaListCollection.user.name,
    avatarUrl: data.MediaListCollection.user.avatar?.large ?? null,
    // Custom lists repeat entries that already appear in the status list
    entries: data.MediaListCollection.lists
      .filter((list) => !list.isCustomList)
      .flatMap((list) => list.entries),
  };
}

export type AniListUser = { id: number; name: string; avatarUrl: string | null };

type AniListUserFields = { id: number; name: string; avatar: { large: string | null } | null };

function toUser(user: AniListUserFields): AniListUser {
  return { id: user.id, name: user.name, avatarUrl: user.avatar?.large ?? null };
}

// AniList returns at most 50 per page; 4 pages keeps a big following list to 5 requests in all
const FOLLOWING_PAGE_SIZE = 50;
const FOLLOWING_MAX_PAGES = 4;

/**
 * The users someone follows on AniList, by name. AniList has no separate friends feature, so
 * these are their friends. `total` can be larger than the list when it stops at the page limit.
 */
export async function getFollowing(
  userName: string,
  token?: string
): Promise<{ user: AniListUser; following: AniListUser[]; total: number }> {
  const { User } = await query<{ User: AniListUserFields }>(
    'query ($name: String) { User(name: $name) { id name avatar { large } } }',
    { name: userName },
    token
  );

  const following: AniListUser[] = [];
  let total = 0;
  for (let page = 1; page <= FOLLOWING_MAX_PAGES; page++) {
    const { Page } = await query<{
      Page: {
        pageInfo: { total: number; hasNextPage: boolean };
        following: AniListUserFields[];
      };
    }>(
      `query ($id: Int!, $page: Int) {
        Page(page: $page, perPage: ${FOLLOWING_PAGE_SIZE}) {
          pageInfo { total hasNextPage }
          following(userId: $id, sort: USERNAME) { id name avatar { large } }
        }
      }`,
      { id: User.id, page },
      token
    );
    following.push(...Page.following.map(toUser));
    total = Page.pageInfo.total;
    if (!Page.pageInfo.hasNextPage) break;
  }

  return { user: toUser(User), following, total };
}

/** The user the token belongs to. */
export async function getViewer(token: string): Promise<AniListUser> {
  if (!token) throw new AniListTokenError('An access token is required to identify the user');

  const data = await query<{ Viewer: AniListUserFields }>(
    'query { Viewer { id name avatar { large } } }',
    {},
    token
  );

  return toUser(data.Viewer);
}

/** Sets the watched episode count on the token owner's own list entry. */
export async function saveProgress(
  token: string,
  mediaId: number,
  progress: number
): Promise<number> {
  if (!token) throw new AniListTokenError('An access token is required to update progress');

  const data = await query<{ SaveMediaListEntry: { progress: number } }>(
    `mutation ($mediaId: Int, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { progress }
    }`,
    { mediaId, progress },
    token
  );

  return data.SaveMediaListEntry.progress;
}

export function getAiredEpisodes(media: AniListMedia): number | null {
  if (media.status === 'FINISHED') {
    return media.episodes;
  }

  if (media.status === 'NOT_YET_RELEASED') {
    return null;
  }

  // Airing shows may have no next episode scheduled yet
  return media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : null;
}

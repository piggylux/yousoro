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
};

export type AniListEntry = {
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
    throw new Error(`AniList API returned ${response.status}: ${messages}`);
  }

  return body.data;
}

/** Fetches a user's whole "Watching" list, media details included, in a single request. */
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
      MediaListCollection(userName: $userName, type: ANIME, status: CURRENT) {
        user { id name avatar { large } }
        lists { isCustomList entries { progress updatedAt media { ${MEDIA_FIELDS} } } }
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

/** The user the token belongs to. */
export async function getViewer(
  token: string
): Promise<{ id: number; name: string; avatarUrl: string | null }> {
  if (!token) throw new AniListTokenError('An access token is required to identify the user');

  const data = await query<{
    Viewer: { id: number; name: string; avatar: { large: string | null } | null };
  }>('query { Viewer { id name avatar { large } } }', {}, token);

  return {
    id: data.Viewer.id,
    name: data.Viewer.name,
    avatarUrl: data.Viewer.avatar?.large ?? null,
  };
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

import { type Cookies, error, fail, type RequestEvent } from '@sveltejs/kit';

import { AniListNotFoundError, AniListTokenError, saveEntry } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { parseEntryUpdate } from '#lib/server/entry-update.js';
import { clearSession, type Session } from '#lib/server/session.js';
import { isDomain } from '#lib/types/domain.js';

import type { Actions } from './$types';

/** @type {import('./$types').PageServerLoad} */
export async function load({
  params,
  locals,
  cookies,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
}) {
  // Only AniList is supported for now
  if (!isDomain(params.domain)) {
    error(404, `Unknown domain: ${params.domain}`);
  }

  let userAnimeList;
  try {
    userAnimeList = await new AniListApi(locals.session?.token).getUserAnimeList(params.username);
  } catch (err) {
    if (err instanceof AniListNotFoundError) {
      error(404, `There's no AniList user named ${params.username}`);
    }
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    userAnimeList = await new AniListApi().getUserAnimeList(params.username);
  }
  const { userId, username, avatarUrl, scoreFormat, animeList } = userAnimeList;

  return {
    domain: params.domain,
    username,
    avatarUrl,
    canEdit: userId !== null && locals.session?.user.id === userId,
    watchingList: animeList,
    scoreFormat,
    userProfileLink: `https://anilist.co/user/${encodeURIComponent(username)}/animelist/Watching`,
  };
}

/**
 * Runs an update on the signed-in user's own AniList list, whatever list the page shows, and
 * turns what can go wrong into a message for the card
 */
async function updateOwnList<T>(
  { params, locals, cookies }: Pick<RequestEvent, 'params' | 'locals' | 'cookies'>,
  update: (session: Session) => Promise<T>
) {
  if (params.domain !== 'anilist') {
    return fail(400, { message: 'Only AniList lists can be updated' });
  }
  if (!locals.session) {
    return fail(401, { message: 'Sign in with AniList to update your list' });
  }
  try {
    return await update(locals.session);
  } catch (err) {
    console.error(err);
    if (err instanceof AniListTokenError) {
      clearSession(cookies);
      return fail(401, { message: 'Your AniList sign-in expired, please sign in again' });
    }
    return fail(502, { message: 'AniList rejected the update, please try again' });
  }
}

export const actions: Actions = {
  /**
   * Saves the watched episode count, the score, or both, from the card's +1 button, the card's
   * back, or the score prompt after completing an anime. A field that isn't sent stays as it is
   */
  updateEntry: async (event) => {
    const update = parseEntryUpdate(await event.request.formData());
    if ('message' in update) return fail(400, { message: update.message });
    const { mediaId, changes } = update;
    return updateOwnList(event, async (session) => ({
      mediaId,
      ...(await saveEntry(session.token, mediaId, changes)),
    }));
  },
};

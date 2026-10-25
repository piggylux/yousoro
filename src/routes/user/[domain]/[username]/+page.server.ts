import { type Cookies, error, fail, type RequestEvent } from '@sveltejs/kit';

import { withoutHiddenMature } from '#lib/anime.js';
import { HIDDEN_SECTIONS_COOKIE, parseHiddenSections } from '#lib/hidden-sections.js';
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
  isDataRequest,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
  isDataRequest: boolean;
}) {
  // Only AniList is supported for now
  if (!isDomain(params.domain)) {
    error(404, `Unknown domain: ${params.domain}`);
  }
  // Read on every load, so the list is rendered already filtered
  const hiddenSections = parseHiddenSections(cookies.get(HIDDEN_SECTIONS_COOKIE));

  let userAnimeList;
  try {
    userAnimeList = await getUserAnimeList(params.username, locals, cookies);
  } catch (err) {
    if (err instanceof AniListNotFoundError) {
      error(404, `There's no AniList user named ${params.username}`);
    }
    // In the browser, the page may already show this list, reloading it by itself or after a
    // save. It keeps showing it then (see +page.ts), rather than an error the viewer didn't ask for
    if (!isDataRequest) throw err;
    console.error(err);
    return { unavailable: true as const, username: params.username, hiddenSections };
  }
  const { userId, username, avatarUrl, scoreFormat, animeList } = userAnimeList;

  return {
    domain: params.domain,
    username,
    avatarUrl,
    canEdit: userId !== null && locals.session?.user.id === userId,
    // Anime AniList marks as adult are left out entirely when the viewer chose not to see them
    watchingList: withoutHiddenMature(animeList, locals.preferences.showMature),
    scoreFormat,
    hiddenSections,
    userProfileLink: `https://anilist.co/user/${encodeURIComponent(username)}/animelist/Watching`,
  };
}

async function getUserAnimeList(username: string, locals: App.Locals, cookies: Cookies) {
  try {
    return await new AniListApi(locals.session?.token).getUserAnimeList(username);
  } catch (err) {
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    return await new AniListApi().getUserAnimeList(username);
  }
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

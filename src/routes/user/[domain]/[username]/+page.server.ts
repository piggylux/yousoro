import { type Cookies, error, fail } from '@sveltejs/kit';

import { AniListTokenError, saveProgress } from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { clearSession } from '#lib/server/session.js';
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
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    userAnimeList = await new AniListApi().getUserAnimeList(params.username);
  }
  const { userId, username, avatarUrl, animeList } = userAnimeList;

  return {
    domain: params.domain,
    username,
    avatarUrl,
    canEdit: userId !== null && locals.session?.user.id === userId,
    watchingList: animeList,
    userProfileLink: `https://anilist.co/user/${encodeURIComponent(username)}/animelist/Watching`,
  };
}

export const actions: Actions = {
  updateProgress: async ({ request, params, locals, cookies }) => {
    if (params.domain !== 'anilist') {
      return fail(400, { message: 'Only AniList lists can be updated' });
    }
    if (!locals.session) {
      return fail(401, { message: 'Sign in with AniList to update your progress' });
    }

    const form = await request.formData();
    const mediaId = Number(form.get('mediaId'));
    const progress = Number(form.get('progress'));
    if (!Number.isInteger(mediaId) || mediaId <= 0 || !Number.isInteger(progress) || progress < 0) {
      return fail(400, { message: 'Invalid episode count' });
    }

    // The update always goes to the token owner's own list, whatever list the page shows
    try {
      return { mediaId, progress: await saveProgress(locals.session.token, mediaId, progress) };
    } catch (err) {
      console.error(err);
      if (err instanceof AniListTokenError) {
        clearSession(cookies);
        return fail(401, { message: 'Your AniList sign-in expired, please sign in again' });
      }
      return fail(502, { message: 'AniList rejected the update, please try again' });
    }
  },
};

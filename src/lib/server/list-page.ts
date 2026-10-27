import { error, type Cookies } from '@sveltejs/kit';

import { withoutHiddenMature } from '#lib/anime.js';
import { HIDDEN_SECTIONS_COOKIE, parseHiddenSections } from '#lib/hidden-sections.js';
import {
  AniListNotFoundError,
  AniListTokenError,
  AniListRateLimitError,
} from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearSession } from '#lib/server/session.js';
import { isDomain } from '#lib/types/domain.js';

export async function loadAnimePage({
  params,
  locals,
  cookies,
  isDataRequest,
  getClientAddress,
  url,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
  isDataRequest: boolean;
  getClientAddress: () => string;
  url?: URL;
}) {
  // Only AniList is supported for now
  if (!isDomain(params.domain)) {
    error(404, `Unknown domain: ${params.domain}`);
  }
  // Read on every load, so the list is rendered already filtered
  const hiddenSections = parseHiddenSections(cookies.get(HIDDEN_SECTIONS_COOKIE));

  let userAnimeList;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read', 2);
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    userAnimeList = await getUserAnimeList(
      params.username,
      locals,
      cookies,
      url?.searchParams.get('view') !== 'calendar'
    );
  } catch (err) {
    if (err instanceof AniListRateLimitError) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      if (!isDataRequest)
        error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
    }
    if (err instanceof AniListNotFoundError) {
      error(404, `There's no AniList user named ${params.username}`);
    }
    // In the browser, the page may already show this list, reloading it by itself or after a
    // save. It keeps showing it then (see +page.ts), rather than an error the viewer didn't ask for
    if (!isDataRequest) throw err;
    console.error(err);
    return {
      unavailable: true as const,
      username: params.username,
      hiddenSections,
      retryAt: err instanceof AniListRateLimitError ? Date.now() + err.retryAfter * 1000 : 0,
    };
  }
  const { userId, username, avatarUrl, scoreFormat, animeList } = userAnimeList;

  return {
    airingsEnriched: url?.searchParams.get('view') !== 'calendar',
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

async function getUserAnimeList(
  username: string,
  locals: App.Locals,
  cookies: Cookies,
  enrichAirings: boolean
) {
  try {
    return await new AniListApi(locals.session?.token).getUserAnimeList(username, enrichAirings);
  } catch (err) {
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    return await new AniListApi().getUserAnimeList(username, enrichAirings);
  }
}

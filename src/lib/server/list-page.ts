import { error, type Cookies } from '@sveltejs/kit';

import { withoutHiddenMature } from '#lib/anime.js';
import { HIDDEN_SECTIONS_COOKIE, parseHiddenSections } from '#lib/hidden-sections.js';
import { isUserName } from '#lib/match.js';
import {
  AniListNotFoundError,
  AniListTokenError,
  AniListRateLimitError,
} from '#lib/server/anilist-client.js';
import { AniListApi } from '#lib/server/anilist.js';
import { MAL_ENABLED, withMalToken } from '#lib/server/myanimelist-auth.js';
import {
  MalForbiddenError,
  MalNotFoundError,
  MalRateLimitError,
  MalTokenError,
} from '#lib/server/myanimelist-client.js';
import { MyAnimeListApi } from '#lib/server/myanimelist.js';
import { takeClientLimit } from '#lib/server/rate-limit.js';
import { clearMalSession, clearSession } from '#lib/server/session.js';
import type { UserAnimeList } from '#lib/types/api.js';
import { DOMAIN_NAMES, isDomain, type Domain } from '#lib/types/domain.js';

type ListEvent = { locals: App.Locals; cookies: Cookies };

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
  // MyAnimeList lists need this site's MyAnimeList client
  if (!isDomain(params.domain) || (params.domain === 'myanimelist' && !MAL_ENABLED)) {
    error(404, `Unknown domain: ${params.domain}`);
  }
  const domain = params.domain;
  // Read on every load, so the list is rendered already filtered
  const hiddenSections = parseHiddenSections(cookies.get(HIDDEN_SECTIONS_COOKIE));

  let userAnimeList;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read', 2);
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    userAnimeList = await getUserAnimeList(
      domain,
      params.username,
      { locals, cookies },
      url?.searchParams.get('view') !== 'calendar'
    );
  } catch (err) {
    const rateLimited = err instanceof AniListRateLimitError || err instanceof MalRateLimitError;
    if (rateLimited) {
      locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
      if (!isDataRequest)
        error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
    }
    if (err instanceof AniListNotFoundError || err instanceof MalNotFoundError) {
      error(404, `There's no ${DOMAIN_NAMES[domain]} user named ${params.username}`);
    }
    if (err instanceof MalForbiddenError) {
      error(403, `MyAnimeList didn't share ${params.username}'s list. It may be private.`);
    }
    // In the browser, the page may already show this list, reloading it by itself or after a
    // save. It keeps showing it then (see +page.ts), rather than an error the viewer didn't ask for
    if (!isDataRequest) throw err;
    console.error(err);
    return {
      unavailable: true as const,
      username: params.username,
      hiddenSections,
      retryAt: rateLimited ? Date.now() + err.retryAfter * 1000 : 0,
    };
  }
  const { userId, username, avatarUrl, scoreFormat, animeList } = userAnimeList;
  const viewer = domain === 'anilist' ? locals.session : locals.malSession;
  const unmatched = withoutHiddenMature(
    userAnimeList.unmatched ?? [],
    locals.preferences.showMature
  );

  return {
    airingsEnriched: url?.searchParams.get('view') !== 'calendar',
    domain,
    username,
    avatarUrl,
    canEdit: userId !== null && viewer?.user.id === userId,
    // Anime AniList marks as adult are left out entirely when the viewer chose not to see them
    watchingList: withoutHiddenMature(animeList, locals.preferences.showMature),
    scoreFormat,
    hiddenSections,
    userProfileLink:
      domain === 'anilist'
        ? `https://anilist.co/user/${encodeURIComponent(username)}/animelist/Watching`
        : `https://myanimelist.net/animelist/${encodeURIComponent(username)}?status=1`,
    ...(unmatched.length ? { unmatched } : {}),
  };
}

function getUserAnimeList(
  domain: Domain,
  username: string,
  event: ListEvent,
  enrichAirings: boolean
): Promise<UserAnimeList> {
  return domain === 'anilist'
    ? getAniListList(username, event, enrichAirings)
    : getMalList(username, event, enrichAirings);
}

async function getAniListList(
  username: string,
  { locals, cookies }: ListEvent,
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

async function getMalList(username: string, event: ListEvent, enrichAirings: boolean) {
  const session = event.locals.malSession;
  // Their own list is read with their token, which shows it to them even when it's private
  if (session && session.user.name.toLowerCase() === username.toLowerCase()) {
    try {
      return await withMalToken(event, (token) =>
        new MyAnimeListApi({ token, owner: session.user }).getUserAnimeList(username, enrichAirings)
      );
    } catch (err) {
      if (!(err instanceof MalTokenError)) throw err;
      // The sign-in can't be renewed: sign them out and read the public list instead
      clearMalSession(event.cookies);
      event.locals.malSession = null;
    }
  }
  if (!isUserName(username)) throw new MalNotFoundError(`Not a MyAnimeList name: ${username}`);
  return await new MyAnimeListApi().getUserAnimeList(username, enrichAirings);
}

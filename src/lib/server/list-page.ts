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
import type { PlanningPageData, UserAnimeList } from '#lib/types/api.js';
import { DOMAIN_NAMES, isDomain, type Domain } from '#lib/types/domain.js';

type ListEvent = { locals: App.Locals; cookies: Cookies };

/** The list's service; any other is turned away, and so is MyAnimeList without this site's client */
function listDomain(domain: string): Domain {
  if (!isDomain(domain) || (domain === 'myanimelist' && !MAL_ENABLED)) {
    error(404, `Unknown domain: ${domain}`);
  }
  return domain;
}

/**
 * Throws what a failed read means for the viewer: the list not existing or not being shared, or,
 * when `busyIsError`, the service being busy. Returns how many seconds to wait when it was busy,
 * and null for any other error, which the caller handles
 */
function checkReadError(
  err: unknown,
  domain: Domain,
  username: string,
  locals: App.Locals,
  busyIsError: boolean
): number | null {
  const rateLimited = err instanceof AniListRateLimitError || err instanceof MalRateLimitError;
  if (rateLimited) {
    locals.retryAfter = Math.max(locals.retryAfter ?? 0, err.retryAfter);
    if (busyIsError)
      error(429, { message: err.message, retryAt: Date.now() + err.retryAfter * 1000 });
  }
  if (err instanceof AniListNotFoundError || err instanceof MalNotFoundError) {
    error(404, `There's no ${DOMAIN_NAMES[domain]} user named ${username}`);
  }
  if (err instanceof MalForbiddenError) {
    error(403, `MyAnimeList didn't share ${username}'s list. It may be private.`);
  }
  return rateLimited ? err.retryAfter : null;
}

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
  const domain = listDomain(params.domain);
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
    const retryAfter = checkReadError(err, domain, params.username, locals, !isDataRequest);
    // In the browser, the page may already show this list, reloading it by itself or after a
    // save. It keeps showing it then (see +page.ts), rather than an error the viewer didn't ask for
    if (!isDataRequest) throw err;
    console.error(err);
    return {
      unavailable: true as const,
      username: params.username,
      hiddenSections,
      retryAt: retryAfter === null ? 0 : Date.now() + retryAfter * 1000,
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
    ...(unmatched.length ? { unmatched } : {}),
  };
}

/**
 * The anime someone plans to watch that are out, for the planning page, most recently planned
 * first. Those that haven't aired yet can't be started, so they're only counted, and not sent.
 * Unlike the watching list, it's always read whole and at once, and there's no earlier copy to
 * fall back on, so a busy service is an error
 */
export async function loadPlanningPage({
  params,
  locals,
  cookies,
  getClientAddress,
}: {
  params: { username: string; domain: string };
  locals: App.Locals;
  cookies: Cookies;
  getClientAddress: () => string;
}): Promise<PlanningPageData> {
  const domain = listDomain(params.domain);
  const { username } = params;
  let list;
  try {
    const limit = await takeClientLimit(getClientAddress(), 'read');
    if (!limit.allowed) throw new AniListRateLimitError(limit.retryAfter);
    list = await readList(domain, username, { locals, cookies }, (api) =>
      api.getPlannedAnime(username)
    );
  } catch (err) {
    checkReadError(err, domain, username, locals, true);
    throw err;
  }
  const viewer = domain === 'anilist' ? locals.session : locals.malSession;
  const name = encodeURIComponent(list.username);
  const planned = withoutHiddenMature(list.planned, locals.preferences.showMature);
  const out = planned
    .filter((anime) => anime.status !== 'NOT_YET_RELEASED')
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  /*
   * Prequels are narrowed to this list once it holds only the anime the page shows: one hidden by
   * the viewer's mature setting, or not aired yet, can't be started, so it never holds up a sequel.
   * They are compared by airing order rather than story order, as AniList counts a prequel made
   * later, such as Fate/Zero, as the prequel of what it precedes, and that one is watched first
   */
  const airedOn = new Map(
    out.flatMap((anime) =>
      anime.id === null || anime.startedOn === null ? [] : [[anime.id, anime.startedOn] as const]
    )
  );
  /*
   * A sequel the page lists itself is a part of its own, so only the others are said to follow:
   * ones not planned, and planned ones not aired yet. Mature ones follow the viewer's setting
   */
  const listed = new Set(out.map(({ id }) => id));
  const plannedIds = new Set(planned.map(({ id }) => id));
  const { showMature } = locals.preferences;
  // Of when each was planned and started, only the order and the prequels it gives are shown
  const outNow = out.map(({ addedAt: _addedAt, startedOn, prequelIds, allSequels, ...anime }) => ({
    ...anime,
    prequels:
      startedOn === null
        ? []
        : prequelIds.filter((id) => (airedOn.get(id) ?? Infinity) < startedOn),
    sequels: allSequels
      .filter(({ id, isAdult }) => !listed.has(id) && (showMature || !isAdult))
      .map(({ isAdult: _isAdult, ...sequel }) => ({
        ...sequel,
        planned: plannedIds.has(sequel.id),
      })),
  }));
  return {
    domain,
    username: list.username,
    canEdit: list.userId !== null && viewer?.user.id === list.userId,
    planned: outNow,
    upcoming: planned.length - outNow.length,
    userProfileLink:
      domain === 'anilist'
        ? `https://anilist.co/user/${name}/animelist/Planning`
        : `https://myanimelist.net/animelist/${name}?status=6`,
  };
}

function getUserAnimeList(
  domain: Domain,
  username: string,
  event: ListEvent,
  enrichAirings: boolean
): Promise<UserAnimeList> {
  return readList(domain, username, event, (api) => api.getUserAnimeList(username, enrichAirings));
}

/** Reads one of someone's lists, as the signed-in viewer when that shows them more */
function readList<T>(
  domain: Domain,
  username: string,
  event: ListEvent,
  read: (api: AniListApi | MyAnimeListApi) => Promise<T>
): Promise<T> {
  return domain === 'anilist' ? readAniList(event, read) : readMal(username, event, read);
}

async function readAniList<T>(
  { locals, cookies }: ListEvent,
  read: (api: AniListApi) => Promise<T>
): Promise<T> {
  try {
    return await read(new AniListApi(locals.session?.token));
  } catch (err) {
    if (!(err instanceof AniListTokenError) || !locals.session) throw err;
    // The signed-in user's token expired: sign them out and read the public list instead
    clearSession(cookies);
    locals.session = null;
    return await read(new AniListApi());
  }
}

async function readMal<T>(
  username: string,
  event: ListEvent,
  read: (api: MyAnimeListApi) => Promise<T>
): Promise<T> {
  const session = event.locals.malSession;
  // Their own list is read with their token, which shows it to them even when it's private
  if (session && session.user.name.toLowerCase() === username.toLowerCase()) {
    try {
      return await withMalToken(event, (token) =>
        read(new MyAnimeListApi({ token, owner: session.user }))
      );
    } catch (err) {
      if (!(err instanceof MalTokenError)) throw err;
      // The sign-in can't be renewed: sign them out and read the public list instead
      clearMalSession(event.cookies);
      event.locals.malSession = null;
    }
  }
  if (!isUserName(username)) throw new MalNotFoundError(`Not a MyAnimeList name: ${username}`);
  return await read(new MyAnimeListApi());
}

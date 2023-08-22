import { AniListApi } from '$lib/server/anilist';
import { MyAnimeListApi } from '$lib/server/myanimelist';
import type { Domain } from '$lib/types/domain';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params }: { params: { username: string; domain: Domain } }) {
  let apiClass;
  switch (params.domain) {
    case 'myanimelist':
      apiClass = new MyAnimeListApi();
      break;
    case 'anilist':
      apiClass = new AniListApi();
      break;
    default:
      apiClass = null;
  }

  if (!apiClass) {
    throw TypeError(`Unknown domain: ${params.domain}`);
  }

  let userProfileLink: string;
  switch (params.domain) {
    case 'myanimelist':
      userProfileLink = `https://myanimelist.net/animelist/${params.username}?status=1`;
      break;
    case 'anilist':
      userProfileLink = `https://anilist.co/user/${params.username}/animelist/Watching`;
      break;
    default:
      userProfileLink = '';
  }

  return {
    domain: params.domain,
    username: params.username,
    watchingList: apiClass.getAnimeList(params.username),
    userProfileLink,
  };
}

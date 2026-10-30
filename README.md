# Yousoro

Keep track of your anime watching list.

Yousoro shows the anime you're currently watching on [AniList](https://anilist.co) or
[MyAnimeList](https://myanimelist.net) and tells you how far behind you are. Each card shows how many aired episodes you haven't watched yet, and the
shows you're actively watching come first. Once you've watched an episode, mark it with one click.

## Features

- **Sign in with AniList or MyAnimeList**: use your existing account to get started.
- **See what to watch**: check your unwatched episodes at a glance, with active shows first.
- **Track your progress**: mark episodes as watched in one click and save updates to your list.
- **Plan your next watch**: see next-episode countdowns and browse four weeks of airing dates in
  your local time zone.
- **Keep up with rewatches**: track rewatch progress alongside your current shows.
- **Share and discover**: browse friends' lists, share yours, and see which anime you're watching
  together.
- **Compare tastes**: see how well your AniList scores match anyone's, the anime you both loved,
  where you disagree, and what each of you should watch next. Share a link so friends can compare
  themselves with you.

## Search and sharing metadata

The production origin is `https://yousoro.vercel.app`. Page titles, descriptions, canonical URLs,
social previews, and home-page structured data are managed in `src/lib/seo.ts` and `Seo.svelte`.
Preview images are drawn by `src/lib/server/preview-image.ts`: the site's own at `/preview.png`,
prerendered at build time, and one for each list at `/user/anilist/<name>/preview.jpg`, drawn
from the public list and cached for an hour. Taste matches have one at
`/user/anilist/<name>/match/<other>/preview.jpg`, and invitations to compare at
`/user/anilist/<name>/match/preview.jpg`.

Taste matches are worked out in the browser from `/api/taste/<name>`, a trimmed profile of a public
list that the CDN keeps for an hour. However often a match link is shared, AniList is asked for
each list about once an hour, and those reads give way first when the app's AniList budget runs low.
If the public domain changes, update `SITE_ORIGIN`, `static/robots.txt`, and `static/sitemap.xml`
together. The sitemap lists the landing page; public AniList lists can be discovered through links.
Settings, sign-in, friends, errors, signed-in responses, and non-production hosts use `noindex`.

## Development

Requires [Bun](https://bun.sh). Create an [AniList API client](https://anilist.co/settings/developer)
with the redirect URL `http://localhost:5173/auth/anilist/callback`, and put its ID in `.env` as
`ANILIST_CLIENT_ID` (see `.env.example`).

MyAnimeList is optional. To turn it on, create a
[MyAnimeList API client](https://myanimelist.net/apiconfig) of the "web" type with the redirect URL
`http://localhost:5173/auth/myanimelist/callback`, and put its ID and secret in `.env` as
`MAL_CLIENT_ID` and `MAL_CLIENT_SECRET`. MyAnimeList lists take aired episodes and airing times
from AniList, matched by MyAnimeList id. Friends, taste matches, groups, years in anime and badges
are AniList-only. Then:

```bash
bun install
bun run dev
```

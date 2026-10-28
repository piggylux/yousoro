# Yousoro

Keep track of your anime watching list.

Yousoro shows the anime you're currently watching on [AniList](https://anilist.co) and tells you
how far behind you are. Each card shows how many aired episodes you haven't watched yet, and the
shows you're actively watching come first. Once you've watched an episode, mark it with one click.

## Features

- **Sign in with AniList**: use your existing account to get started.
- **See what to watch**: check your unwatched episodes at a glance, with active shows first.
- **Track your progress**: mark episodes as watched in one click and save updates to AniList.
- **Plan your next watch**: see next-episode countdowns and browse four weeks of airing dates in
  your local time zone.
- **Keep up with rewatches**: track rewatch progress alongside your current shows.
- **Share and discover**: browse friends' lists, share yours, and see which anime you're watching
  together.

## Search and sharing metadata

The production origin is `https://yousoro.vercel.app`. Page titles, descriptions, canonical URLs,
social previews, and home-page structured data are managed in `src/lib/seo.ts` and `Seo.svelte`.
Preview images are drawn by `src/lib/server/preview-image.ts`: the site's own at `/preview.png`,
prerendered at build time, and one for each list at `/user/anilist/<name>/preview.jpg`, drawn
from the public list and cached for an hour.
If the public domain changes, update `SITE_ORIGIN`, `static/robots.txt`, and `static/sitemap.xml`
together. The sitemap lists the landing page; public AniList lists can be discovered through links.
Settings, sign-in, friends, errors, signed-in responses, and non-production hosts use `noindex`.

## Development

Requires [Bun](https://bun.sh). Create an [AniList API client](https://anilist.co/settings/developer)
with the redirect URL `http://localhost:5173/auth/anilist/callback`, and put its ID in `.env` as
`ANILIST_CLIENT_ID` (see `.env.example`). Then:

```bash
bun install
bun run dev
```

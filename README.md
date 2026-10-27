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

## Development

Requires [Bun](https://bun.sh). Create an [AniList API client](https://anilist.co/settings/developer)
with the redirect URL `http://localhost:5173/auth/anilist/callback`, and put its ID in `.env` as
`ANILIST_CLIENT_ID` (see `.env.example`). Then:

```bash
bun install
bun run dev
```

# Yousoro

Keep track of your anime watching list.

Yousoro shows the anime you're currently watching on [AniList](https://anilist.co) and tells you
how far behind you are. Each card shows how many aired episodes you haven't watched yet, and the
shows you're actively watching come first. Once you've watched an episode, mark it with one click.

## Features

- **Sign in with AniList**: no account to create; Yousoro uses AniList's own sign-in
- **Episodes to watch**: a badge on each anime counts the aired episodes you haven't seen, and a
  banner adds them up for the whole list
- **Active shows first**: anime with episodes to watch are listed by when you last updated them
  on AniList, so what you're watching right now is at the top
- **Rewatches**: anime on your AniList "Rewatching" list appear too, with how many episodes are
  left; they don't count towards the episodes you're behind on
- **Next episode countdown**: caught-up anime show when their next episode airs, in your own time
  zone, and the soonest come first
- **Airing status**: anime you're caught up on or have completed say so, and shows with no
  episode info (next episode not scheduled, on hiatus, not aired yet, cancelled) are labelled and
  listed last
- **Progress tracking**: a progress bar and "watched / total" count on every card
- **Quick updates**: a +1 button marks the next episode as watched, and the card's details let you
  set any episode count; changes are saved straight to your AniList list
- **Shareable lists**: anyone's watching list is viewable at `/user/anilist/<username>`
- **Friends**: `/user/anilist/<username>/friends` lists the people a user follows on AniList, with
  a link to each one's watching list
- **Watching together**: signed-in viewers see their friends watching or rewatching each anime,
  with avatars and episode progress. Your Friends page also lists the anime you share. Lookups
  batch anime together and reuse results in browser memory for five minutes; large results are
  capped at four pages and labelled as partial.
  Your own avatar appears on other people's lists when you're watching the same anime.

## Development

Requires [Bun](https://bun.sh). Create an [AniList API client](https://anilist.co/settings/developer)
with the redirect URL `http://localhost:5173/auth/anilist/callback`, and put its ID in `.env` as
`ANILIST_CLIENT_ID` (see `.env.example`). Then:

```bash
bun install
bun run dev
```

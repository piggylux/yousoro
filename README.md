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

Cookies store versioned JSON (`{"v":1,"data":…}`, see `src/lib/server/versioned-cookie.ts`), so a
format can change later: bump its version and add a migration from the old one.

## Development

Requires [Bun](https://bun.sh) and Node.js 22.17 or later.

1. Create an AniList API client at <https://anilist.co/settings/developer> with the redirect URL
   `http://localhost:5173/auth/anilist/callback`.
2. Copy `.env.example` to `.env` and set `ANILIST_CLIENT_ID` to the client's ID (a number). It
   isn't a secret, and no other configuration is needed.
3. Install and start:

   ```bash
   bun install
   bun run dev
   ```

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `bun run dev`    | Start the dev server                             |
| `bun run build`  | Build for production                             |
| `bun run check`  | Type-check with `svelte-check`                   |
| `bun run test`   | Run the tests in watch mode                      |
| `bun run lint`   | Check formatting with oxfmt and lint with oxlint |
| `bun run format` | Format the code with oxfmt                       |

A deployed site needs its own AniList client, with the redirect URL
`<site origin>/auth/anilist/callback`, since each client allows a single redirect URL.

Built with SvelteKit, Svelte 5, Tailwind CSS and daisyUI. Formatting and linting use the
[oxc](https://oxc.rs) tools, oxfmt and oxlint; for format-on-save, use the oxc editor extension.

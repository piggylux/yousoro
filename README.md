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
- **Episode calendar**: browse four weeks of AniList airing times for your Watching and Rewatching
  anime in your local time zone, with a directional slide between weeks (or no motion when preferred).
  Busy days preview three episodes; View all opens a scrollable day dialog. The calendar clearly labels
  the covered dates, missing air dates, and incomplete/unavailable results. Air dates are never estimated
  and may differ from streaming availability. The catch-up banner stays on the list view.
  Schedule lookups batch up to 500 media IDs, fetch 50 airings per page with a four-page limit,
  and respect rate-limit retry timing. Public airing metadata is fresh for one hour on the server
  and in browser memory, with a visibly labelled fallback retained for up to 24 hours if a refresh
  fails. Failed refreshes do not extend that retention period. Identical pending lookups coalesce,
  and complete lookups include negative coverage. Authenticated list data is never stored in this cache.
  Changing weeks or opening a dialog requires no new requests. Mature-content preferences apply to both views.
- **Navigation**: quickly switch between your anime, calendar, and friends. Public lists also
  offer a Calendar link; the calendar URL is the list URL with `?view=calendar`.
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

Successful progress and score saves update the visible list from AniList's confirmed response,
without fetching the list again. Browser navigation reuses list data for up to one minute (or the
next known episode's airing time, whichever comes first). This memory cache is scoped to the viewer
and mature-content preference, clears on account changes/logout, and is bypassed for live refreshes
and retries. Saves patch cached entries without extending the freshness of the rest of the list.
Calendar-only list reads skip the recent-airing badge query; returning to the list restores that
enrichment. Friends pages reuse the signed-in viewer's known profile ID, and overlapping pending
friend lookups share their common IDs before requesting only the remainder. No authenticated data
is stored in a shared server cache or persistent browser storage.
Hovering links preloads code only, so it neither spends AniList requests nor holds stale list data
outside the browser cache. Confirmed saves patch all cached preference variants, and reads already
in flight preserve any progress or completion saved after they started.

When AniList rate-limits a read, the affected list, Friends lookup, or calendar automatically retries
up to twice after the supplied cooldown. A countdown shows the retry status. Retries pause in hidden
tabs, cancel on navigation/account changes, and reuse existing lookup coalescing and caches. Partial
lookups retain their results while waiting. Progress saves are never replayed automatically; failures
other than rate limits remain manual retries.

## Development

Requires [Bun](https://bun.sh). Create an [AniList API client](https://anilist.co/settings/developer)
with the redirect URL `http://localhost:5173/auth/anilist/callback`, and put its ID in `.env` as
`ANILIST_CLIENT_ID` (see `.env.example`). Then:

```bash
bun install
bun run dev
```

/**
 * Where a MyAnimeList sign-in starts, coming back to `redirectTo`. The server runs the sign-in, as
 * it needs the client secret (see src/lib/server/myanimelist-auth.ts)
 */
export function malSignInPath(redirectTo: string): string {
  return `/auth/myanimelist?${new URLSearchParams({ redirectTo })}`;
}

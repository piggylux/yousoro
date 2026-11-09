import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.includes('node_modules') ? undefined : true),
      },

      // Deployed on Vercel. The runtime is pinned rather than taken from the Node version that runs
      // the build, so local builds on a newer Node still target a runtime Vercel supports.
      adapter: adapter({ runtime: 'nodejs24.x' }),

      // Only this site's own scripts may run, so an injected script can't read the sign-in token
      // on the callback page. SvelteKit adds hashes or nonces for its own inline scripts.
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          // Svelte writes inline styles for transitions and the progress bar widths
          'style-src': ['self', 'unsafe-inline'],
          // Anime covers and avatars come from AniList's CDN; MyAnimeList avatars from its own
          'img-src': ['self', 'data:', 'https://s4.anilist.co', 'https://cdn.myanimelist.net'],
          // The browser talks to this site, which calls AniList and MyAnimeList for lists and
          // saves. Searching for an anime to add asks AniList directly, without a token, so each
          // search uses the viewer's own AniList allowance rather than the app's shared one
          'connect-src': ['self', 'https://graphql.anilist.co'],
          'form-action': ['self'],
          'base-uri': ['self'],
          'object-src': ['none'],
          'frame-ancestors': ['none'],
        },
      },
    }),
  ],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
  },
});

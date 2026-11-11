<script lang="ts">
  import { pruneChanges } from '#lib/change-history.js';
  import BackToTop from '#lib/components/BackToTop.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import { setFriendsViewer } from '#lib/friend-watching.js';
  import { setListContext, viewerKey } from '#lib/list-data.js';

  import type { LayoutProps } from './$types';
  import Header from './Header.svelte';

  import './styles.css';
  import '../app.css';

  let { data, children }: LayoutProps = $props();

  $effect(() => {
    setFriendsViewer(data.user?.id ?? null);
    setListContext(viewerKey(data.user, data.malUser), data.preferences.showMature);
    // The history of recent changes is the signed-in accounts' alone: signing out drops its own
    pruneChanges([
      ...(data.user ? [{ domain: 'anilist' as const, id: data.user.id }] : []),
      ...(data.malUser ? [{ domain: 'myanimelist' as const, id: data.malUser.id }] : []),
    ]);
  });

  $effect(() => {
    if (data.preferences.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = data.preferences.theme;
  });
</script>

<Seo />

<a class="skip-link" href="#main-content">Skip to content</a>

<div class="app">
  <Header
    user={data.user}
    malUser={data.malUser}
    malEnabled={data.malEnabled}
    preferences={data.preferences}
  />

  <!-- Focusable from script only, so "Back to top" can move focus here -->
  <main id="main-content" tabindex="-1">
    {@render children()}
  </main>

  <BackToTop />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 24px 16px;
    /* Room below the content for the floating "Back to top" button, so it never covers a control */
    padding-bottom: calc(1rem + 64px);
    /* Full width, so the anime grid can use wide screens; narrower content centers itself */
    width: min(100%, 1600px);
    margin: 0 auto;
    box-sizing: border-box;
    outline: none;
  }
</style>

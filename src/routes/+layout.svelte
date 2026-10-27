<script lang="ts">
  import BackToTop from '#lib/components/BackToTop.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import { setFriendsViewer } from '#lib/friend-watching.js';
  import { setListContext } from '#lib/list-data.js';

  import type { LayoutProps } from './$types';
  import Header from './Header.svelte';

  import './styles.css';
  import '../app.css';

  let { data, children }: LayoutProps = $props();

  $effect(() => {
    setFriendsViewer(data.user?.id ?? null);
    setListContext(data.user?.id ?? null, data.preferences.showMature);
  });

  $effect(() => {
    if (data.preferences.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = data.preferences.theme;
  });
</script>

<Seo />

<div class="app">
  <Header user={data.user} preferences={data.preferences} />

  <!-- Focusable from script only, so "Back to top" can move focus here -->
  <main tabindex="-1">
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
    padding: 1rem;
    /* Room below the content for the floating "Back to top" button, so it never covers a control */
    padding-bottom: calc(1rem + 64px);
    /* Full width, so the anime grid can use wide screens; narrower content centers itself */
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
    outline: none;
  }
</style>

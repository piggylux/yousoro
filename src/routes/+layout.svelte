<script lang="ts">
  import { navigating } from '$app/state';
  import { untrack } from 'svelte';

  import { pruneChanges } from '#lib/change-history.js';
  import BackToTop from '#lib/components/BackToTop.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import PageSkeleton from '#lib/components/skeletons/PageSkeleton.svelte';
  import { setFriendsViewer } from '#lib/friend-watching.js';
  import { setListContext, viewerKey } from '#lib/list-data.js';
  import {
    SKELETON_AFTER_MS,
    SKELETON_LABELS,
    ownsList,
    skeletonFor,
    type SkeletonKind,
  } from '#lib/navigation-skeleton.js';

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

  let main = $state<HTMLElement>();

  /**
   * The skeleton of the page a navigation is going to, once it has taken long enough to notice. It
   * lies over the page being left, which stays laid out underneath, out of sight, rather than taken
   * down, so it comes back as it was if the navigation goes nowhere. Keeping that page's height
   * keeps the scroll position: SvelteKit notes where the page was scrolled to only once the next one
   * has loaded, for Back to return there, and it restores a page's place on Back before the skeleton
   * goes. The skeleton starts where the viewer is looking, `top` below main's top; the new page then
   * starts at the top, or where Back left it
   */
  let skeleton = $state<{
    kind: SkeletonKind;
    domain?: string;
    username?: string;
    top: number;
  } | null>(null);
  $effect(() => {
    const { to } = navigating;
    const kind = to ? skeletonFor(navigating) : null;
    if (!to || !kind) {
      skeleton = null;
      return;
    }
    const next = { kind, domain: to.params?.domain, username: to.params?.username };
    // Already showing one: on to the next page's straight away, in the same place
    const shown = untrack(() => skeleton);
    if (shown) {
      skeleton = { ...next, top: shown.top };
      return;
    }
    const timer = setTimeout(() => {
      // How far main's top has scrolled out of view, so the skeleton starts on screen
      skeleton = { ...next, top: Math.max(0, -(main?.getBoundingClientRect().top ?? 0)) };
    }, SKELETON_AFTER_MS);
    return () => clearTimeout(timer);
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
  <main id="main-content" tabindex="-1" aria-busy={skeleton !== null} bind:this={main}>
    {#if skeleton}
      <!-- Takes no room of its own: the skeleton lies over the page it covers -->
      <div class="skeleton-layer">
        <div class="page-skeleton" style:top="{skeleton.top}px">
          <PageSkeleton
            kind={skeleton.kind}
            cardSize={data.preferences.cardSize}
            own={ownsList(skeleton, data)}
            anilist={skeleton.domain !== 'myanimelist'}
          />
        </div>
      </div>
    {/if}
    <div class="page" class:covered={skeleton !== null} inert={skeleton !== null}>
      {@render children()}
    </div>
    <p class="tw:sr-only" role="status">{skeleton ? SKELETON_LABELS[skeleton.kind] : ''}</p>
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

  /* The page lays out as if it were main's own content */
  .page {
    display: contents;
  }
  /* Out of sight while a skeleton covers it, but still laid out, so the scroll position holds */
  .page.covered {
    visibility: hidden;
  }
  /* At the top of main's content, where the page starts */
  .skeleton-layer {
    position: relative;
    height: 0;
  }
  /* Laid out as main lays out a page */
  .page-skeleton {
    position: absolute;
    inset-inline: 0;
    display: flex;
    flex-direction: column;
  }
</style>

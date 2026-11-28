<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack, type Snippet } from 'svelte';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';

  let {
    heading,
    loading,
    what,
  }: {
    /** What went wrong, as the page's heading */
    heading: string;
    /**
     * The page in outline, for a first load that answered before what it shows did (see
     * first-load.ts): the browser reads it now, and it fills in once it has
     */
    loading: Snippet;
    /** What's loading, as "Alice’s list": "Loading Alice’s list", "… to see Alice’s list" */
    what: string;
  } = $props();

  const reload = () => void goto(page.url.href, { refreshAll: true, replace: true });
  const stillReading = $derived(page.error?.loading === true);

  $effect(() => {
    if (stillReading) untrack(reload);
  });
</script>

{#if stillReading}
  {@render loading()}
  <p class="tw:sr-only" role="status">Loading {what}. {page.error?.message}</p>
  <!-- Only the browser's script reads it from here; without it, a reload is the way on -->
  <noscript>
    <p class="error-message">
      <a href={page.url.href}>Reload the page</a> in a moment to see {what}.
    </p>
  </noscript>
{:else}
  <section class="error-page">
    <p class="error-code">Error {page.status}</p>
    <h1>{heading}</h1>
    <p class="error-message">{page.error?.message}</p>
    <AutoReadRetry
      retryKey={`page:${page.data.user?.id ?? 'public'}:${page.url.pathname}:${page.url.search}`}
      retryAt={page.status === 429 ? (page.error?.retryAt ?? 0) : 0}
      onretry={reload}
    />
    {#if page.status === 429}<button class="tw:btn" onclick={reload}>Try again</button>{/if}

    <a class="home-link" href="/home">Back to home</a>
  </section>
{/if}

<style>
  .error-page {
    width: min(100%, 40rem);
    margin: 64px auto;
    /* Long usernames wrap rather than run off narrow screens */
    overflow-wrap: anywhere;
  }
  .error-code {
    color: var(--text-accent);
    font-size: 0.875rem;
  }
  h1 {
    margin-top: 8px;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .error-message {
    margin: 12px 0 24px;
    color: var(--text-accent);
  }
  .home-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--you-blue);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>

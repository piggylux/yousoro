<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { untrack } from 'svelte';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
  import Spinner from '#lib/components/Spinner.svelte';

  /** The first load answered before the list did, so the browser reads it now (see list-page.ts) */
  const loading = $derived(page.error?.loading === true);

  const reload = () => void goto(page.url.href, { invalidateAll: true, replaceState: true });

  $effect(() => {
    if (loading) untrack(reload);
  });
</script>

<section class="error-page">
  {#if loading}
    <Spinner />
    <h1>Loading {page.params.username}’s list</h1>
    <p class="error-message" role="status">{page.error?.message}</p>
    <!-- Only the browser's script reads the list from here; without it, a reload is the way on -->
    <noscript>
      <p class="error-message">
        <a href={page.url.href}>Reload the page</a> in a moment to see the list.
      </p>
    </noscript>
  {:else}
    <p class="error-code">Error {page.status}</p>
    <h1>{page.status === 404 ? 'List not found' : 'Unable to load this list'}</h1>
    <p class="error-message">{page.error?.message}</p>
    <AutoReadRetry
      retryKey={`page:${page.data.user?.id ?? 'public'}:${page.url.pathname}:${page.url.search}`}
      retryAt={page.status === 429 ? (page.error?.retryAt ?? 0) : 0}
      onretry={reload}
    />
    {#if page.status === 429}<button class="tw:btn" onclick={reload}>Try again</button>{/if}
  {/if}

  <a class="home-link" href="/home">Back to home</a>
</section>

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

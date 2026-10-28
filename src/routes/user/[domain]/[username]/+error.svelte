<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
</script>

<section class="error-page">
  <p class="error-code">Error {page.status}</p>
  <h1>{page.status === 404 ? 'List not found' : 'Unable to load this list'}</h1>
  <p class="error-message">{page.error?.message}</p>
  <AutoReadRetry
    retryKey={`page:${page.data.user?.id ?? 'public'}:${page.url.pathname}:${page.url.search}`}
    retryAt={page.status === 429 ? (page.error?.retryAt ?? 0) : 0}
    onretry={() => void goto(page.url.href, { invalidateAll: true, replaceState: true })}
  />
  {#if page.status === 429}<button
      class="tw:btn"
      onclick={() => void goto(page.url.href, { invalidateAll: true, replaceState: true })}
      >Try again</button
    >{/if}

  <a class="home-link" href="/home">Back to home</a>
</section>

<style>
  .error-page {
    width: min(100%, 40rem);
    margin: 64px auto;
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

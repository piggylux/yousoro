<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  import AutoReadRetry from '#lib/components/AutoReadRetry.svelte';
</script>

<h1>{page.status}: {page.error?.message}</h1>
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

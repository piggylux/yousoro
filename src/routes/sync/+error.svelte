<script lang="ts">
  import { page } from '$app/state';

  import PageError from '#lib/components/PageError.svelte';
  import SyncSkeleton from '#lib/components/skeletons/SyncSkeleton.svelte';
</script>

<PageError
  heading={page.status === 404 ? 'Syncing isn’t available' : 'Unable to load your lists'}
  what="your lists"
>
  {#snippet loading()}<SyncSkeleton />{/snippet}
</PageError>

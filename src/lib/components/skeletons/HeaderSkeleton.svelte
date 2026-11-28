<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';

  let {
    title = '16rem',
    summary = '18rem',
    back = true,
  }: {
    /** How wide the page's heading is */
    title?: string;
    /** How wide the line under it is */
    summary?: string;
    /** Whether the page has a button back to the list beside its heading */
    back?: boolean;
  } = $props();
</script>

<!-- A page's heading and the line under it, with the button back to the list beside them -->
<div class="header">
  <span class="copy">
    <!-- The heading's line box, and the summary's -->
    <Skeleton width={title} height="2.1875rem" />
    <span class="summary"><Skeleton width={summary} height="0.85rem" /></span>
  </span>
  {#if back}<span class="back"><Skeleton width="12rem" height="100%" /></span>{/if}
</div>

<style>
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 24px;
    margin-bottom: 22px;
  }
  .copy {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .summary {
    display: block;
    padding: 4px 0;
  }
  .back {
    display: block;
    height: 42px;
  }
</style>

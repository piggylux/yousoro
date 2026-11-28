<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';

  let {
    controls,
  }: {
    /** The widths of the chips, menus and buttons after the search, in order */
    controls: string[];
  } = $props();
</script>

<!-- The search and filters above a list, as ListFilters lays them out -->
<div class="toolbar">
  <span class="search"><Skeleton height="40px" /></span>
  <span class="controls">
    {#each controls as width, index (index)}<Skeleton {width} height="40px" />{/each}
  </span>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    margin: 0 0 32px;
    padding: 16px 0;
    border-top: 1px solid var(--border-subtle);
  }
  .search {
    display: block;
    width: 14rem;
    max-width: 100%;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  /* On a phone, the search gets a row of its own, above the filters */
  @media (max-width: 480px) {
    .search {
      width: 100%;
    }
  }
</style>

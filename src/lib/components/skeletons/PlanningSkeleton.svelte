<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';
  import HeaderSkeleton from '#lib/components/skeletons/HeaderSkeleton.svelte';
  import ToolbarSkeleton from '#lib/components/skeletons/ToolbarSkeleton.svelte';

  // The airing and short chips, then the genre and order menus and the "Pick for me" button
  const CONTROLS = ['6.5rem', '9.75rem', '6.25rem', '9rem', '6.5rem'];
  // Each row's title, other title, details and genres, varied so they read as text
  const ROWS = [
    ['42%', '30%', '24%', '16%'],
    ['56%', '38%', '22%', '12%'],
    ['36%', '28%', '26%', '18%'],
    ['48%', '34%', '20%', '14%'],
    ['40%', '26%', '24%', '16%'],
    ['52%', '36%', '22%', '12%'],
  ];
</script>

<!-- The plan list's heading, filters and rows, as they'll be laid out -->
<div class="planning-skeleton" aria-hidden="true">
  <HeaderSkeleton title="17rem" summary="20rem" />
  <ToolbarSkeleton controls={CONTROLS} />
  <ul class="rows">
    {#each ROWS as [title, other, details, genres], index (index)}
      <li class="row">
        <span class="cover"><Skeleton ratio="3 / 4" /></span>
        <span class="copy">
          <Skeleton width={title} height="0.95rem" />
          <Skeleton width={other} height="0.8rem" />
          <Skeleton width={details} height="0.75rem" />
          <Skeleton width={genres} height="0.7rem" />
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .planning-skeleton {
    width: 100%;
    max-width: 70rem;
    margin: 24px auto 0;
  }
  /* The list's panel, a row per series */
  .rows {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    list-style: none;
  }
  /* The cover beside its title and details */
  .row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
  }
  .row + .row {
    border-top: 1px solid var(--border-subtle);
  }
  .copy {
    display: grid;
    gap: 10px;
  }
</style>

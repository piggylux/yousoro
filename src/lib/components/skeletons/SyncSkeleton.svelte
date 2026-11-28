<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';

  // Each anime's title and what differs, varied so they read as text
  const ITEMS = [
    ['62%', '44%'],
    ['48%', '52%'],
    ['70%', '38%'],
    ['54%', '46%'],
  ];
</script>

<!-- The sync page's heading, introduction and the anime that differ, as they'll be laid out -->
<div class="sync-skeleton" aria-hidden="true">
  <Skeleton width="15rem" height="2rem" />
  <span class="intro">
    <Skeleton width="100%" height="0.9rem" />
    <Skeleton width="72%" height="0.9rem" />
  </span>
  <ul class="items">
    {#each ITEMS as [title, detail], index (index)}
      <li class="item">
        <Skeleton ratio="3 / 4" />
        <span class="copy">
          <Skeleton width={title} height="0.95rem" />
          <Skeleton width={detail} />
          <Skeleton width="30%" />
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .sync-skeleton {
    width: 100%;
    max-width: 40rem;
    margin: 16px auto 0;
  }
  .intro {
    display: grid;
    gap: 8px;
    margin: 16px 0 24px;
  }
  .items {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* An anime that differs: its cover beside what each list says */
  .item {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }
  .copy {
    display: grid;
    align-content: start;
    gap: 10px;
  }
</style>

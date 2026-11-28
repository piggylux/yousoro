<script lang="ts">
  import Skeleton from '#lib/components/Skeleton.svelte';
  import HeaderSkeleton from '#lib/components/skeletons/HeaderSkeleton.svelte';

  // Each friend's name, varied so they read as names
  const NAMES = ['7rem', '5.5rem', '8rem', '6rem', '7.5rem', '5rem', '6.5rem', '8.5rem', '6rem'];
</script>

<!-- The friends page's heading, filter and grid of friends, as they'll be laid out -->
<div class="friends-skeleton" aria-hidden="true">
  <HeaderSkeleton title="12rem" summary="16rem" />
  <!-- Taste twins: who shares their taste, with its button -->
  <div class="twins">
    <span class="twins-copy">
      <Skeleton width="7rem" height="1rem" />
      <Skeleton width="min(100%, 26rem)" />
    </span>
    <span class="twins-button"><Skeleton width="8rem" height="100%" /></span>
  </div>
  <div class="toolbar">
    <span class="control"><Skeleton width="13rem" height="100%" /></span>
    <span class="control search"><Skeleton height="100%" /></span>
  </div>
  <ul class="grid">
    {#each NAMES as name, index (index)}
      <li class="tile">
        <Skeleton width="44px" height="44px" round />
        <span class="copy">
          <Skeleton width={name} height="0.95rem" />
          <Skeleton width="70%" />
        </span>
        <span class="covers">
          <Skeleton width="36px" height="48px" />
          <Skeleton width="36px" height="48px" />
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .friends-skeleton {
    width: 100%;
    max-width: 70rem;
    margin: 24px auto 0;
  }
  .twins {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 16px;
    min-height: 93px;
    margin-bottom: 20px;
    padding: 18px 20px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-sizing: border-box;
  }
  .twins-copy {
    display: grid;
    flex: 1 1 16rem;
    gap: 10px;
  }
  .twins-button {
    display: block;
    height: 42px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }
  .control {
    display: block;
    height: 48px;
  }
  .search {
    width: 14rem;
    max-width: 100%;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* A friend's tile: avatar, name and what they're watching */
  .tile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    height: 112px;
    padding: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-sizing: border-box;
  }
  .copy {
    display: grid;
    gap: 10px;
  }
  .covers {
    display: flex;
    gap: 6px;
  }
  @media (max-width: 480px) {
    /* The button goes under the explanation, which wraps */
    .twins {
      min-height: 166px;
    }
    .search {
      width: 100%;
    }
  }
</style>

<script lang="ts">
  let {
    name,
    avatarUrl,
    size = 32,
  }: {
    id: number;
    name: string;
    avatarUrl: string | null;
    size?: number;
  } = $props();
  let failed = $state(false);
  $effect(() => {
    void avatarUrl;
    failed = false;
  });
</script>

<span class="avatar" style={`--avatar-size: ${size}px`} aria-hidden="true">
  {#if avatarUrl && !failed}
    <img src={avatarUrl} alt="" loading="lazy" onerror={() => (failed = true)} />
  {:else}
    <span>{name.charAt(0).toUpperCase()}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-grid;
    place-items: center;
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    background: var(--you-blue-pale);
    color: var(--you-blue);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }
  span > span {
    font-size: calc(var(--avatar-size) * 0.38);
    font-weight: 800;
    line-height: 1;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>

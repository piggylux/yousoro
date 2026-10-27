<script lang="ts">
  let {
    id,
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

<span
  class="avatar"
  style={`--avatar-size: ${size}px; --avatar-hue: ${(id * 47 + 190) % 360}`}
  aria-hidden="true"
>
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
    background: linear-gradient(
      145deg,
      hsl(var(--avatar-hue) 65% 86%),
      hsl(calc(var(--avatar-hue) + 25) 55% 65%)
    );
    color: hsl(var(--avatar-hue) 55% 26%);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.35);
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

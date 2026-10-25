<script lang="ts">
  import { flip } from 'svelte/animate';
  import { prefersReducedMotion } from 'svelte/motion';
  import { fade } from 'svelte/transition';

  import { sortWatchingList } from '#lib/anime.js';
  import AnimeCard from '#lib/components/AnimeCard.svelte';
  import BacklogBanner from '#lib/components/BacklogBanner.svelte';
  import YousoroCelebration from '#lib/components/YousoroCelebration.svelte';
  import type { Anime } from '#lib/types/anime.js';
  import type { AnimePageData } from '#lib/types/api.js';

  let { data }: { data: AnimePageData } = $props();

  const animeList = $derived(sortWatchingList(data.watchingList));

  // Cards slide to their new place when an update reorders the list, instead of jumping there
  const duration = $derived(prefersReducedMotion.current ? 0 : 500);

  const animeLinkFn = (animeId: number) => `https://anilist.co/anime/${animeId}/`;

  // The "Yousoro!" celebration currently playing; a new one restarts the animation
  let celebration = $state<{ kind: 'caught-up' | 'completed'; title: string; key: number } | null>(
    null
  );

  function celebrate(kind: 'caught-up' | 'completed', anime: Anime) {
    celebration = { kind, title: anime.title, key: Date.now() };
  }
</script>

<svelte:head>
  <title>{data.username} - Yousoro</title>
  <meta name="description" content={`${data.username}'s watching list`} />
</svelte:head>

<section>
  <!-- One compact row, so the cards start high enough for two full rows to fit on screen -->
  <div class="profile-bar">
    <a class="profile" href={data.userProfileLink} target="_blank">
      {#if data.avatarUrl}
        <img class="avatar-img" src={data.avatarUrl} alt={`${data.username}'s profile picture`} />
      {/if}
      <span>
        <span class="name">{data.username}</span>
        <span class="profile-link">AniList profile ↗</span>
      </span>
    </a>

    <!-- Updates with every progress change, since the list reloads after each one -->
    <BacklogBanner
      animeList={data.watchingList}
      username={data.username}
      isOwnList={data.canEdit}
    />
  </div>

  <div class="anime-grid">
    {#each animeList as anime (anime.id)}
      <!-- Fades out a show that leaves the Watching list, e.g. once AniList marks it completed -->
      <div animate:flip={{ duration }} out:fade={{ duration: duration / 2 }}>
        <AnimeCard {anime} {animeLinkFn} canEdit={data.canEdit} onCaughtUp={celebrate} />
      </div>
    {/each}
  </div>
</section>

{#if celebration}
  {#key celebration.key}
    <YousoroCelebration
      kind={celebration.kind}
      title={celebration.title}
      onDone={() => (celebration = null)}
    />
  {/key}
{/if}

<style>
  .profile-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 16px 28px;
    /* Clear space above the first row, whose badges stick out above the cards */
    margin-bottom: 72px;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }

  .name {
    display: block;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .profile-link {
    font-size: 0.85rem;
    opacity: 0.65;
  }

  .profile:hover .profile-link {
    opacity: 1;
    text-decoration: underline;
  }
  /*
   * As many card columns as fit, from one on phones up to as many as a wide screen allows. The
   * grid is centered as a block; a short last row stays left-aligned, so the order stays clear.
   */
  .anime-grid {
    --card-width: 300px;
    display: grid;
    grid-template-columns: repeat(
      auto-fit,
      minmax(min(var(--card-width), 100%), var(--card-width))
    );
    justify-content: center;
    /* Rows leave room for the badges above each card */
    gap: 28px 24px;
  }

  /*
   * On larger screens, cards shrink with the window height (down to 200px wide) so two full
   * rows fit without scrolling. A card is its 3:4 cover plus 108px of title and progress, and the
   * grid starts about 222px down the page; 262px also counts the gap between rows and a little slack.
   */
  @media (min-width: 768px) {
    .anime-grid {
      --card-width: clamp(200px, calc(20px + 0.75 * ((100svh - 262px) / 2 - 108px)), 300px);
    }
  }
</style>

<script lang="ts">
  import AnimeCard from '#lib/components/AnimeCard.svelte';
  import type { AnimePageData } from '#lib/types/api.js';

  let { data }: { data: AnimePageData } = $props();

  const animeLinkFn = $derived.by(() => {
    switch (data.domain) {
      case 'myanimelist':
        return (animeId: number) => `https://myanimelist.net/anime/${animeId}/`;
      case 'anilist':
        return (animeId: number) => `https://anilist.co/anime/${animeId}/`;
      default:
        return () => '';
    }
  });
</script>

<svelte:head>
  <title>{data.username} - Yousoro</title>
  <meta name="description" content={`${data.username}'s watching list`} />
</svelte:head>

<section>
  <div class="username flex justify-center">
    <a class="btn btn-outline glass" href={data.userProfileLink} target="_blank"
      >{data.username}'s profile</a
    >
  </div>

  <div class="anime-grid">
    {#each data.watchingList as anime}
      <AnimeCard {anime} {animeLinkFn} />
    {/each}
  </div>
</section>

<style>
  .username {
    font-size: larger;
    margin-bottom: 20px;
  }
  .anime-grid {
    display: grid;
    grid-template-columns: auto auto auto;
    justify-content: space-evenly;
    row-gap: 20px;
  }

  @media (max-width: 1000px) and (min-width: 700px) {
    .anime-grid {
      grid-template-columns: auto auto;
    }
  }

  @media (max-width: 700px) {
    .anime-grid {
      grid-template-columns: auto;
    }
  }
</style>

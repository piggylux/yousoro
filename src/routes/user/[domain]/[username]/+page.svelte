<script lang="ts">
  import AnimeCard from '$lib/components/AnimeCard.svelte';
  import type { Anime } from '$lib/types/anime';

  /** @type {import('./$types').PageData} */
  export let data: { username: string; watchingList: Anime[] };
</script>

<svelte:head>
  <title>{data?.username} - Yousoro</title>
  <meta name="description" content={`${data?.username}'s watching list`} />
</svelte:head>

<section>
  <div class="username flex justify-center">
    <a
      class="btn btn-outline glass"
      href={`https://myanimelist.net/animelist/${data.username}?status=1`}
      target="_blank">{data.username}'s profile</a
    >
  </div>

  <div class="anime-grid">
    {#each data?.watchingList as anime}
      <AnimeCard bind:anime />
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

<script lang="ts">
  import type { Anime } from '$lib/types/anime';

  export let anime: Anime;
  export let animeLinkFn: (animeId: number) => string;

  let modal: HTMLDialogElement;

  function openModal() {
    modal.showModal();
  }
</script>

<div class="indicator">
  {#if anime.numberAiredEpisodes && anime.numberAiredEpisodes - anime.currentEpisode > 0}
    <span class="indicator-item badge badge-secondary">
      {anime.numberAiredEpisodes - anime.currentEpisode}
    </span>
  {/if}
  <button class="card shadow-xl" on:click={openModal}>
    <img
      src={anime.thumbnailUrl}
      alt={anime.title}
      class:up-to-date={!anime.numberAiredEpisodes ||
        anime.numberAiredEpisodes - anime.currentEpisode === 0}
    />
    <span class="text-center font-bold">{anime.title}</span>
  </button>
</div>

<dialog bind:this={modal} class="modal">
  <form method="dialog" class="modal-box">
    <a class="font-bold text-lg link link-hover" href={animeLinkFn(anime.id)} target="_blank"
      >{anime.title}</a
    >
    <p class="py-4">Progression: {anime.currentEpisode} / {anime.numberEpisodes}</p>
  </form>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>

<style>
  .card {
    max-width: 300px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: #ffffff;
    cursor: pointer;
  }

  .indicator-item {
    font-weight: bold;
  }

  .indicator:hover {
    animation: 0.2s pulse forwards;
  }

  img {
    border-radius: var(--rounded-box, 1rem) var(--rounded-box, 1rem) 0 0;
    max-height: 400px;
    max-width: 300px;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
    }

    100% {
      transform: scale(1.03);
    }
  }
</style>

<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Domain } from '#lib/types/domain.js';
  import type { UserDomain } from '#lib/types/user-domain.js';

  const domainOptions: UserDomain[] = [
    { label: 'MyAnimeList', value: 'myanimelist' },
    { label: 'AniList', value: 'anilist' },
  ];

  let username = $state('');
  let domain = $state<Domain>('myanimelist');

  function submit(event: SubmitEvent) {
    event.preventDefault();
    goto(`/user/${domain}/${username}`);
  }
</script>

<form class="flex flex-row justify-center" onsubmit={submit}>
  <div class="join">
    <div>
      <input
        class="input input-bordered join-item"
        placeholder="Username"
        bind:value={username}
        required
      />
    </div>

    <select class="select select-bordered join-item" bind:value={domain}>
      {#each domainOptions as domainOption}
        <option value={domainOption.value} disabled={domainOption.disabled}>
          {domainOption.label}
        </option>
      {/each}
    </select>

    <button class="btn btn-primary join-item" type="submit" disabled={!username}>
      ヨーソロー！
    </button>
  </div>
</form>

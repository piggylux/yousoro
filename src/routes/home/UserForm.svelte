<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Domain } from '$lib/types/domain';
  import type { UserDomain } from '$lib/types/user-domain';

  const domainOptions: UserDomain[] = [
    { label: 'MyAnimeList', value: 'myanimelist' },
    { label: 'AniList', value: 'anilist' },
  ];

  let username = '';
  let domain: Domain = 'myanimelist';

  function submit() {
    goto(`/user/${domain}/${username}`);
  }
</script>

<form class="flex flex-row justify-center" on:submit|preventDefault={submit}>
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

<script lang="ts">
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const listUrl = (name: string) => `/user/anilist/${encodeURIComponent(name)}`;
  const people = (count: number) =>
    `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`;
</script>

<svelte:head>
  <title>{data.user.name}'s friends - Yousoro</title>
  <meta name="description" content={`The people ${data.user.name} follows on AniList`} />
</svelte:head>

<section>
  <div class="friends-header">
    {#if data.user.avatarUrl}
      <img
        class="avatar-img"
        src={data.user.avatarUrl}
        alt={`${data.user.name}'s profile picture`}
      />
    {/if}
    <div>
      <h1 class="name">{data.isOwnPage ? 'Your friends' : `${data.user.name}'s friends`}</h1>
      <p class="summary">
        {data.isOwnPage ? "You're following" : `${data.user.name} follows`}
        {people(data.total)} on AniList ·
        <a class="tw:link" href={listUrl(data.user.name)}>
          {data.isOwnPage ? 'Back to your list' : `${data.user.name}'s list`}
        </a>
      </p>
    </div>
  </div>

  {#if data.friends.length === 0}
    <p class="empty">
      {data.isOwnPage
        ? "You aren't following anyone on AniList yet. Follow people there and they'll show up here."
        : `${data.user.name} isn't following anyone on AniList yet.`}
    </p>
  {:else}
    <ul class="friends-grid">
      {#each data.friends as friend (friend.id)}
        <li>
          <a class="friend" href={listUrl(friend.name)}>
            {#if friend.avatarUrl}
              <img class="friend-avatar" src={friend.avatarUrl} alt="" />
            {:else}
              <span class="friend-avatar initial" aria-hidden="true">
                {friend.name.charAt(0).toUpperCase()}
              </span>
            {/if}
            <span class="friend-name">{friend.name}</span>
            <span class="friend-link">Watching list →</span>
          </a>
        </li>
      {/each}
    </ul>

    {#if data.total > data.friends.length}
      <p class="empty">
        Showing the first {data.friends.length.toLocaleString()} of {people(data.total)}.
      </p>
    {/if}
  {/if}
</section>

<style>
  .friends-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 36px;
  }

  .avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }

  .name {
    font-size: 1.4rem;
    font-weight: 700;
  }

  .summary {
    font-size: 0.9rem;
    opacity: 0.75;
  }

  .friends-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(170px, 100%), 1fr));
    gap: 16px;
    max-width: 72rem;
    margin: 0 auto;
    list-style: none;
  }

  .friend {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 18px 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-box, 1rem);
    background: var(--surface);
    box-shadow: 0 1px 3px rgb(15 61 110 / 0.08);
    transition:
      translate 0.15s ease-out,
      box-shadow 0.15s ease-out;
  }

  .friend:hover,
  .friend:focus-visible {
    translate: 0 -3px;
    box-shadow: 0 8px 18px rgb(15 61 110 / 0.18);
  }

  .friend-avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 0 3px var(--you-blue-pale);
  }

  .initial {
    display: grid;
    place-items: center;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 1.75rem;
    font-weight: 800;
  }

  .friend-name {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-heading);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .friend-link {
    color: var(--text-accent);
    font-size: 0.8rem;
  }

  .empty {
    margin-top: 24px;
    text-align: center;
    opacity: 0.7;
  }

  @media (prefers-reduced-motion: reduce) {
    .friend {
      transition: none;
    }
  }
</style>

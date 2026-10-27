<script lang="ts">
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import type { FriendWatching } from '#lib/types/friend-watching.js';
  let {
    selection,
    onclose,
  }: {
    selection: {
      title: string;
      friends: FriendWatching[];
      coverUrl?: string;
      blurCover?: boolean;
    } | null;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  const heading = $props.id();
  $effect(() => {
    if (selection && dialog && !dialog.open) dialog.showModal();
    else if (!selection && dialog?.open) dialog.close();
  });
</script>

<dialog
  use:closeOnBackdrop
  bind:this={dialog}
  aria-labelledby={heading}
  aria-describedby={`${heading}-description`}
  {onclose}
>
  {#if selection}
    <button
      type="button"
      class="close-dialog"
      onclick={() => dialog?.close()}
      aria-label="Close friends"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg
      >
    </button>
    <header>
      {#if selection.coverUrl}<span class="anime-cover"
          ><img
            src={selection.coverUrl}
            alt=""
            class:blurred={selection.blurCover}
          />{#if selection.blurCover}<span>18+</span>{/if}</span
        >{/if}
      <div class="heading-copy">
        <p class="eyebrow">Watching together</p>
        <h2 id={heading}>{selection.title}</h2>
        <p id={`${heading}-description`} class="description">
          {selection.friends.length}
          {selection.friends.length === 1 ? 'person on this anime' : 'people on this anime'}
        </p>
      </div>
    </header>
    <ul>
      {#each selection.friends as friend (friend.id)}
        <li>
          <a href={`/user/anilist/${encodeURIComponent(friend.name)}`}>
            <FriendAvatar {...friend} size={44} />
            <span class="identity"
              ><strong>{friend.isViewer ? 'You' : friend.name}</strong><span
                >{friend.rewatching ? '↻ Rewatching' : 'Watching'}{friend.isViewer
                  ? ` · ${friend.name}`
                  : ''}</span
              ></span
            >
            <span class="episode"><small>EPISODE</small><strong>{friend.progress}</strong></span>
            <span class="row-arrow" aria-hidden="true">↗</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 29rem);
    max-height: min(80vh, 650px);
    overflow: auto;
    padding: 28px 22px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 24px;
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: 0 30px 100px rgb(3 16 35 / 0.35);
  }
  dialog[open] {
    animation: arrive 180ms ease-out;
  }
  dialog::backdrop {
    background: rgb(5 18 38 / 0.5);
    backdrop-filter: blur(8px);
  }
  .close-dialog {
    position: absolute;
    top: 14px;
    right: 14px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    cursor: pointer;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 18px 24px 4px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .anime-cover {
    position: relative;
    display: flex;
    flex: none;
    width: 52px;
    height: 72px;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgb(15 61 110 / 0.15);
  }
  .anime-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .anime-cover .blurred {
    filter: blur(16px);
    scale: 1.2;
  }
  .anime-cover > span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    text-shadow: 0 1px 5px black;
  }
  .heading-copy {
    min-width: 0;
  }
  .eyebrow {
    margin-bottom: 6px;
    text-transform: uppercase;
    color: var(--text-accent);
    letter-spacing: 0.12em;
    font-size: 0.6rem;
    font-weight: 800;
  }
  h2 {
    font-size: 1.25rem;
    line-height: 1.25;
    font-weight: 800;
    letter-spacing: -0.035em;
    color: var(--text-heading);
    overflow-wrap: anywhere;
  }
  .description {
    margin-top: 6px;
    font-size: 0.75rem;
    opacity: 0.6;
  }
  ul {
    list-style: none;
    padding: 10px 0 0;
  }
  li + li {
    border-top: 1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent);
  }
  a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 8px;
    border-radius: 12px;
    transition: background 150ms ease;
  }
  a:hover {
    background: var(--you-blue-pale);
  }
  a:focus-visible,
  button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  .identity {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .identity strong {
    font-size: 0.85rem;
    color: var(--text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .identity > span {
    font-size: 0.68rem;
    color: var(--text-accent);
    opacity: 0.7;
  }
  .episode {
    margin-left: auto;
    padding: 5px 10px;
    min-width: 56px;
    flex: none;
    border-radius: 10px;
    background: var(--you-blue-pale);
    text-align: center;
    color: var(--text-accent);
  }
  .episode small {
    display: block;
    font-size: 0.48rem;
    letter-spacing: 0.08em;
    font-weight: 700;
    opacity: 0.65;
  }
  .episode strong {
    font-size: 0.95rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .row-arrow {
    color: var(--text-accent);
    opacity: 0.4;
    font-size: 0.9rem;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: 0 10px;
    }
    to {
      opacity: 1;
      translate: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog[open] {
      animation: none;
    }
    a {
      transition: none;
    }
  }
</style>

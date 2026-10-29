<script lang="ts">
  import { page } from '$app/state';

  import CloseButton from '#lib/components/CloseButton.svelte';
  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import ShareButton from '#lib/components/ShareButton.svelte';
  import { closeOnBackdrop } from '#lib/dialog.js';
  import { describeGap, describeRace } from '#lib/race.js';
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
      /**
       * The viewer on their own list, which leaves them out of `friends`; on anyone else's, they're
       * among `friends` when they watch it too
       */
      viewer?: { name: string; progress: number };
    } | null;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  const heading = $props.id();
  $effect(() => {
    if (selection && dialog && !dialog.open) dialog.showModal();
    else if (!selection && dialog?.open) dialog.close();
  });

  // The viewer's place in the race, when they're watching it too
  const viewer = $derived(
    selection?.viewer ?? selection?.friends.find((friend) => friend.isViewer) ?? null
  );
  const others = $derived(selection?.friends.filter((friend) => !friend.isViewer) ?? []);
  const race = $derived(viewer ? describeRace(viewer.progress, others) : null);
  // Whoever is furthest along first, once there's a race to show
  const rows = $derived(
    viewer
      ? (selection?.friends ?? []).toSorted(
          (a, b) => b.progress - a.progress || a.name.localeCompare(b.name)
        )
      : (selection?.friends ?? [])
  );
  // Friends behind the viewer get a nudge; ahead of them, a plea not to spoil it
  const leading = $derived(
    viewer ? others.some((friend) => friend.progress < viewer.progress) : false
  );
  const share = $derived(
    selection && viewer
      ? {
          url: `${page.url.origin}/user/anilist/${encodeURIComponent(viewer.name)}`,
          title: `I'm on episode ${viewer.progress} of ${selection.title}. ${leading ? 'Catch up with me' : 'No spoilers! Follow along'} on Yousoro`,
          note: leading ? 'Nudge your friends to catch up' : 'Ask your friends not to spoil it',
        }
      : null
  );
</script>

<dialog
  use:closeOnBackdrop
  bind:this={dialog}
  aria-labelledby={heading}
  aria-describedby={`${heading}-description`}
  {onclose}
>
  {#if selection}
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
          {selection.friends.length === 1
            ? 'person on this anime'
            : 'people on this anime'}{#if race}.
            <strong>{race}.</strong>{/if}
        </p>
      </div>
      <CloseButton label="Close friends" onclick={() => dialog?.close()} />
    </header>
    <ul>
      {#each rows as friend (friend.id)}
        <li>
          <a href={`/user/anilist/${encodeURIComponent(friend.name)}`}>
            <FriendAvatar {...friend} size={44} />
            <span class="identity">
              <strong title={friend.name}
                >{friend.isViewer ? `You · ${friend.name}` : friend.name}</strong
              >
              <span
                >{friend.rewatching ? '↻ Rewatching' : 'Watching'}{#if viewer && !friend.isViewer}
                  · {describeGap(friend.progress, viewer.progress)}{/if}</span
              >
            </span>
            <span class="episode"><small>Episode</small><strong>{friend.progress}</strong></span>
            <span class="row-arrow" aria-hidden="true">↗</span>
          </a>
        </li>
      {/each}
    </ul>
    {#if share && others.length}
      <footer>
        <span>{share.note}</span>
        <ShareButton url={share.url} title={share.title} subject="your progress" />
      </footer>
    {/if}
  {/if}
</dialog>

<style>
  dialog {
    margin: auto;
    width: min(calc(100vw - 32px), 29rem);
    max-height: min(80vh, 650px);
    overflow: hidden;
    padding: var(--dialog-padding);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--color-base-content);
    box-shadow: var(--shadow-dialog);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: arrive 180ms ease-out;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 16px;
    flex: none;
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
    font-weight: 600;
    text-shadow: 0 1px 5px black;
  }
  .heading-copy {
    flex: 1;
    min-width: 0;
  }
  .eyebrow {
    margin-bottom: 6px;
    text-transform: none;
    color: var(--text-accent);
    letter-spacing: normal;
    font-size: 0.75rem;
    font-weight: 600;
  }
  h2 {
    font-size: 1.25rem;
    line-height: 1.25;
    font-weight: 600;
    letter-spacing: normal;
    color: var(--text-heading);
    overflow-wrap: anywhere;
  }
  .description {
    margin-top: 6px;
    color: var(--text-accent);
    font-size: 0.75rem;
  }
  .description strong {
    color: var(--text-heading);
    font-weight: 600;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
    flex: none;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-accent);
    font-size: 0.8125rem;
  }
  ul {
    list-style: none;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 0;
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
  a:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  .identity {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .identity strong {
    font-size: 0.85rem;
    color: var(--text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    letter-spacing: normal;
    font-weight: 700;
    opacity: 0.65;
  }
  .episode strong {
    font-size: 0.95rem;
    font-weight: 600;
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

<script lang="ts">
  import { page } from '$app/state';

  import FriendAvatar from '#lib/components/FriendAvatar.svelte';
  import SettingsDrawer from '#lib/components/SettingsDrawer.svelte';
  import SignInButton from '#lib/components/SignInButton.svelte';
  import type { Preferences } from '#lib/types/preferences.js';
  import type { SessionUser } from '#lib/types/session-user.js';

  type Props = {
    user: SessionUser | null;
    preferences: Preferences;
  };

  let { user, preferences }: Props = $props();

  let settingsOpen = $state(false);
  const logoutFormId = $props.id();
  let account = $state<HTMLDetailsElement>();

  // The gear opens the settings drawer, except on the settings page, which already shows them. A
  // click meant for a new tab still opens the page there
  function openSettings(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (page.url.pathname === '/settings') return;
    event.preventDefault();
    settingsOpen = true;
  }

  // Come back to the current page after signing in or out
  const redirectTo = $derived(page.url.pathname + page.url.search);
  const navUsername = $derived(user?.name ?? page.params.username);
  const listPath = $derived(
    navUsername ? `/user/anilist/${encodeURIComponent(navUsername)}` : null
  );
  const calendarView = $derived(page.url.searchParams.get('view') === 'calendar');
  const activeNav = $derived(
    listPath && page.url.pathname === listPath
      ? calendarView
        ? 1
        : 0
      : listPath && page.url.pathname === `${listPath}/friends`
        ? 2
        : -1
  );
  $effect(() => {
    void page.url.pathname;
    void page.url.search;
    void user?.id;
    if (account) account.open = false;
  });
</script>

<svelte:window
  onclick={(event) => {
    if (account && event.target instanceof Node && !account.contains(event.target))
      account.open = false;
  }}
  onfocusin={(event) => {
    if (account && event.target instanceof Node && !account.contains(event.target))
      account.open = false;
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && account?.open) {
      account.open = false;
      account.querySelector('summary')?.focus();
    }
  }}
/>

<header>
  <nav aria-label="Main navigation" class:has-links={listPath !== null}>
    <div class="tw:navbar">
      <div class="tw:navbar-start">
        <div class="tw:dropdown">
          <a class="home-link" href="/home" aria-label="Yousoro home">
            <span class="brand-emblem">
              <!-- An anchor, You Watanabe's sailor emblem, drawn like the gear beside it -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="5" r="3" />
                <path d="M12 22V8" />
                <path d="M8 11h8" />
                <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
              </svg>
            </span>
            <span class="brand-type">Yousoro<span class="brand-dot">!</span></span>
          </a>
        </div>
      </div>

      {#if listPath}
        <div
          class="primary-links"
          class:has-selection={activeNav >= 0}
          style:--active-tab={Math.max(0, activeNav)}
        >
          <a href={listPath} aria-current={activeNav === 0 ? 'page' : undefined}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              aria-hidden="true"
              ><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3Z" /></svg
            >
            {user ? 'My anime' : 'Anime list'}
          </a>
          <a href={`${listPath}?view=calendar`} aria-current={activeNav === 1 ? 'page' : undefined}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
              ><rect x="3" y="5" width="18" height="16" rx="3" /><path
                d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2"
              /></svg
            >
            Calendar
          </a>
          <a href={`${listPath}/friends`} aria-current={activeNav === 2 ? 'page' : undefined}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
              ><circle cx="9" cy="8" r="3" /><path
                d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-2-4"
              /></svg
            >
            Friends
          </a>
        </div>
      {/if}
      <div class="tw:navbar-end">
        <a
          class="utility-link"
          href="/settings"
          aria-label="Settings"
          title="Settings"
          aria-haspopup="dialog"
          onclick={openSettings}
        >
          <!-- A gear -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </a>
        <a
          class="utility-link github-link"
          href="https://github.com/Sylux6/yousoro"
          aria-label="GitHub repository"
          title="GitHub repository (opens in a new tab)"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="currentColor"
          >
            <path
              d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
            />
          </svg>
        </a>

        {#if user}
          <details class="account" bind:this={account}>
            <summary class="account-trigger" aria-label={`Signed in as ${user.name}`}>
              <FriendAvatar {...user} size={30} />
              <svg
                class="account-chevron"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg
              >
            </summary>
            <ul class="account-menu">
              <li class="account-name"><span>AniList account</span><strong>{user.name}</strong></li>
              <li><a href={`/user/anilist/${encodeURIComponent(user.name)}`}>My list</a></li>
              <li>
                <a href={`/user/anilist/${encodeURIComponent(user.name)}/friends`}>My friends</a>
              </li>
              <li>
                <button type="submit" form={logoutFormId}>Sign out</button>
              </li>
            </ul>
          </details>
          <form id={logoutFormId} method="POST" action="/auth/logout">
            <input type="hidden" name="redirectTo" value={redirectTo} />
          </form>
        {:else if page.url.pathname !== '/home'}
          <!-- The home page has its own, larger sign-in button -->
          <SignInButton compact {redirectTo} />
        {/if}
      </div>
    </div>
  </nav>
</header>

<SettingsDrawer {preferences} bind:open={settingsOpen} />

<style>
  header {
    container: navigation / inline-size;
    position: relative;
    z-index: 20;
    margin: 8px 12px 0;
    border: 1px solid light-dark(rgb(255 255 255 / 0.9), rgb(141 208 255 / 0.16));
    border-radius: 16px;
    background: linear-gradient(115deg, light-dark(#ffffff, #18324b), light-dark(#f2faff, #10253c));
    box-shadow:
      0 4px 18px -12px rgb(9 42 77 / 0.3),
      inset 0 1px 0 rgb(255 255 255 / 0.08);
  }
  nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    max-width: 1600px;
    margin: 0 auto;
    padding: 7px 16px;
  }
  nav.has-links {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .tw\:navbar {
    display: contents;
  }
  .tw\:navbar-start {
    width: auto;
    grid-column: 1;
    grid-row: 1;
  }
  .tw\:navbar-end {
    width: auto;
    gap: 4px;
    grid-column: -2;
    grid-row: 1;
    justify-self: end;
  }
  .home-link {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    border-radius: 14px;
    text-decoration: none;
  }
  .brand-emblem {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    border: 1px solid rgb(131 211 255 / 0.35);
    border-radius: 11px;
    background: linear-gradient(145deg, #237fb6, #103e69);
    color: #ecfaff;
    box-shadow:
      0 4px 10px -4px rgb(20 95 156 / 0.5),
      inset 0 1px 0 rgb(255 255 255 / 0.25);
  }
  .brand-type {
    color: var(--text-heading);
    font-size: 1.1rem;
    font-weight: 850;
    letter-spacing: -0.045em;
    line-height: 1.1;
  }
  .brand-dot {
    color: var(--text-accent);
  }
  .utility-link {
    display: grid;
    place-items: center;
    min-width: 44px;
    height: 44px;
    color: var(--text-accent);
    border-radius: 14px;
    transition: background 160ms ease;
  }
  .utility-link:hover {
    background: var(--you-blue-pale);
  }
  .github-link {
    opacity: 0.7;
  }
  .github-link:hover {
    opacity: 1;
  }
  .tw\:navbar-end > form {
    display: none;
  }
  .account {
    position: relative;
    margin-left: 6px;
  }
  .account-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 44px;
    padding: 5px 8px 5px 5px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    list-style: none;
    background: var(--surface);
    color: var(--text-accent);
    cursor: pointer;
  }
  .account-trigger::-webkit-details-marker {
    display: none;
  }
  .account-chevron {
    width: 14px;
    height: 14px;
    transition: transform 160ms ease;
  }
  .account[open] .account-chevron {
    transform: rotate(180deg);
  }
  .account[open] .account-trigger {
    border-color: var(--you-blue);
  }
  .account-menu {
    position: absolute;
    top: calc(100% + 12px);
    right: 0;
    width: 220px;
    max-width: calc(100vw - 48px);
    padding: 8px;
    list-style: none;
    border: 1px solid var(--border-subtle);
    border-radius: 18px;
    background: var(--surface);
    box-shadow: 0 14px 36px -10px rgb(5 25 47 / 0.4);
    color: var(--text-heading);
  }
  .account-name {
    padding: 10px 12px 14px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .account-name span {
    display: block;
    font-size: 0.65rem;
    color: var(--text-accent);
    margin-bottom: 4px;
  }
  .account-name strong {
    display: block;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .account-menu a,
  .account-menu button {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 650;
    text-decoration: none;
    cursor: pointer;
  }
  .account-menu a:hover,
  .account-menu button:hover {
    background: var(--you-blue-pale);
  }
  .home-link:focus-visible,
  .utility-link:focus-visible,
  .account-trigger:focus-visible,
  .account-menu a:focus-visible,
  .account-menu button:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 3px;
  }
  .account-menu li:last-child {
    border-top: 1px solid var(--border-subtle);
    margin-top: 4px;
    padding-top: 4px;
  }
  .account-menu button {
    color: var(--text-accent);
  }
  .primary-links {
    position: relative;
    isolation: isolate;
    grid-column: 2;
    grid-row: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: center;
    gap: 4px;
  }
  .primary-links::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: calc((100% - 8px) / 3);
    border-radius: 10px;
    background: linear-gradient(135deg, #1c78b0, #124a7a);
    transform: translateX(calc(var(--active-tab) * (100% + 4px)));
    opacity: 0;
    transition:
      transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 160ms ease;
    pointer-events: none;
  }
  .primary-links.has-selection::before {
    opacity: 1;
  }
  .primary-links a {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-accent);
    text-decoration: none;
    white-space: nowrap;
    transition:
      color 160ms ease,
      background 160ms ease,
      box-shadow 160ms ease;
  }
  .primary-links a:hover {
    background: var(--you-blue-pale);
  }
  .primary-links a[aria-current='page'] {
    color: #ffffff;
    background: transparent;
  }
  .primary-links a[aria-current='page'] svg {
    color: #b1e8ff;
  }
  .primary-links svg {
    width: 18px;
    height: 18px;
    flex: none;
    transition: color 160ms ease;
  }
  .primary-links a:focus-visible {
    outline: 3px solid var(--you-blue);
    outline-offset: 2px;
  }
  @container navigation (max-width: 900px) {
    nav.has-links {
      grid-template-columns: minmax(0, 1fr) auto;
      row-gap: 4px;
    }
    .primary-links {
      grid-row: 2;
      grid-column: 1 / -1;
      justify-self: center;
    }
  }
  @media (max-width: 600px) {
    header {
      margin: 6px 8px 0;
      border-radius: 16px;
    }
  }
  @container navigation (max-width: 600px) {
    nav {
      padding: 5px 12px;
      gap: 8px;
    }
    .github-link {
      display: none;
    }
    .primary-links {
      width: 100%;
    }
    .primary-links a {
      padding: 0 10px;
      gap: 6px;
      font-size: 0.8rem;
    }
    .brand-type {
      font-size: 1.1rem;
    }
    .home-link {
      gap: 8px;
    }
    .account {
      margin-left: 0;
    }
  }
  @container navigation (max-width: 360px) {
    .primary-links a {
      flex-direction: column;
      gap: 4px;
      padding: 7px 4px;
      font-size: 0.75rem;
    }
    .tw\:navbar-end {
      gap: 0;
    }
    .account-chevron {
      display: none;
    }
    .account-trigger {
      padding: 5px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .utility-link,
    .account-chevron,
    .primary-links a,
    .primary-links svg,
    .primary-links::before {
      transition: none;
    }
  }
</style>

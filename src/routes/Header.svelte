<script lang="ts">
  import { page } from '$app/state';

  import SignInButton from '#lib/components/SignInButton.svelte';
  import type { SessionUser } from '#lib/types/session-user.js';

  type Props = {
    user: SessionUser | null;
  };

  let { user }: Props = $props();

  // Come back to the current page after signing in or out
  const redirectTo = $derived(page.url.pathname);
</script>

<header>
  <nav>
    <div class="tw:navbar">
      <div class="tw:navbar-start">
        <div class="tw:dropdown">
          <a class="tw:btn tw:btn-ghost tw:btn-circle" href="/home" aria-label="Home">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <path
                d="M20 7.093l-3-3v-2.093h3v5.093zm4 5.907h-3v10h-18v-10h-3l12-12 12 12zm-10 2h-4v6h4v-6z"
              />
            </svg>
          </a>
        </div>
      </div>

      <div class="tw:navbar-center"></div>

      <div class="tw:navbar-end">
        <a
          class="tw:btn tw:btn-ghost tw:btn-circle"
          href="https://github.com/Sylux6/yousoro"
          aria-label="GitHub repository"
          target="_blank"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
            <path
              d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
            />
          </svg>
        </a>

        {#if user}
          <div class="tw:dropdown tw:dropdown-end">
            <div
              tabindex="0"
              role="button"
              class="tw:btn tw:btn-ghost tw:btn-circle tw:avatar"
              aria-label={`Signed in as ${user.name}`}
            >
              <div class="tw:w-8 tw:rounded-full">
                {#if user.avatarUrl}
                  <img src={user.avatarUrl} alt="" />
                {:else}
                  <span class="tw:font-bold">{user.name.charAt(0).toUpperCase()}</span>
                {/if}
              </div>
            </div>
            <ul
              class="tw:menu tw:dropdown-content tw:z-10 tw:mt-2 tw:w-48 tw:rounded-box tw:bg-base-100 tw:p-2 tw:shadow"
            >
              <li class="tw:menu-title">{user.name}</li>
              <li><a href={`/user/anilist/${encodeURIComponent(user.name)}`}>My list</a></li>
              <li>
                <form method="POST" action="/auth/logout">
                  <input type="hidden" name="redirectTo" value={redirectTo} />
                  <button class="tw:w-full tw:text-left">Sign out</button>
                </form>
              </li>
            </ul>
          </div>
        {:else if page.url.pathname !== '/home'}
          <!-- The home page has its own, larger sign-in button -->
          <SignInButton class="tw:btn tw:btn-ghost tw:btn-sm" {redirectTo} />
        {/if}
      </div>
    </div>
  </nav>
</header>

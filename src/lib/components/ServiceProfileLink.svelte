<script lang="ts">
  import { DOMAIN_NAMES, type Domain, profileUrl } from '#lib/types/domain.js';

  type Props = {
    domain: Domain;
    /** The account's name on that service */
    username: string;
  };

  let { domain, username }: Props = $props();

  const label = $derived(`${username}'s ${DOMAIN_NAMES[domain]} profile`);
</script>

<!-- The service's mark, a small badge beside a name that opens that account's profile -->
<a
  class="service-link"
  href={profileUrl(domain, username)}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={label}
  title={`${label} (opens in a new tab)`}
>
  <!-- Marks from Simple Icons (CC0) -->
  {#if domain === 'anilist'}
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      ><path
        d="M24 17.53v2.421c0 .71-.391 1.101-1.1 1.101h-5l-.057-.165L11.84 3.736c.106-.502.46-.788 1.053-.788h2.422c.71 0 1.1.391 1.1 1.1v12.38H22.9c.71 0 1.1.392 1.1 1.101zM11.034 2.947l6.337 18.104h-4.918l-1.052-3.131H6.019l-1.077 3.131H0L6.361 2.948h4.673zm-.66 10.96-1.69-5.014-1.541 5.015h3.23z"
      /></svg
    >
  {:else}
    <!-- The letters are wider than tall, so the box is cropped to them to read at this size -->
    <svg
      viewBox="0 6 24 12"
      width="28"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      ><path
        d="M8.273 7.247v8.423l-2.103-.003v-5.216l-2.03 2.404-1.989-2.458-.02 5.285H.001L0 7.247h2.203l1.865 2.545 2.015-2.546 2.19.001zm8.628 2.069l.025 6.335h-2.365l-.008-2.871h-2.8c.07.499.21 1.266.417 1.779.155.381.298.751.583 1.128l-1.705 1.125c-.349-.636-.622-1.337-.878-2.082a9.296 9.296 0 0 1-.507-2.179c-.085-.75-.097-1.471.107-2.212a3.908 3.908 0 0 1 1.161-1.866c.313-.293.749-.5 1.1-.687.351-.187.743-.264 1.107-.359a7.405 7.405 0 0 1 1.191-.183c.398-.034 1.107-.066 2.39-.028l.545 1.749H14.51c-.593.008-.878.001-1.341.209a2.236 2.236 0 0 0-1.278 1.92l2.663.033.038-1.81h2.309zm3.992-2.099v6.627l3.107.032-.43 1.775h-4.807V7.187l2.13.03z"
      /></svg
    >
  {/if}
</a>

<style>
  /* Sized like the share button beside it: on the heading's line for a mouse, 44px on touch */
  .service-link {
    display: inline-grid;
    flex: none;
    place-items: center;
    min-width: 32px;
    min-height: 32px;
    margin-block: -1px;
    padding: 0 6px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-control);
    color: var(--text-accent);
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }

  .service-link:hover {
    border-color: var(--you-blue);
    background: var(--you-blue-pale);
    color: var(--action-hover);
  }

  @media (pointer: coarse) {
    .service-link {
      min-width: 44px;
      min-height: 44px;
      margin-block: 0;
    }
  }

  svg {
    display: block;
  }

  @media (prefers-reduced-motion: reduce) {
    .service-link {
      transition: none;
    }
  }
</style>

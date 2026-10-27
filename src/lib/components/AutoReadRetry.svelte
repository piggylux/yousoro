<script lang="ts">
  import { clearReadRetries, MAX_READ_RETRIES, queueReadRetry } from '#lib/read-retry.js';
  let {
    retryAt,
    retryKey,
    recovered = false,
    onretry,
  }: { retryAt: number; retryKey: string; recovered?: boolean; onretry: () => void } = $props();
  let attempt = $state(0);
  let now = $state(Date.now());
  $effect(() => {
    attempt = 0;
    if (recovered) {
      clearReadRetries(retryKey);
      return;
    }
    if (!retryAt) return;
    const queued = queueReadRetry(retryKey, retryAt, onretry);
    attempt = queued?.attempt ?? 0;
    return () => queued?.cancel();
  });
  $effect(() => {
    if (!retryAt) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
</script>

{#if retryAt && !recovered}<p role="status">
    {#if attempt}AniList is busy. Retrying automatically in {Math.max(
        0,
        Math.ceil((retryAt - now) / 1000)
      )}s ({attempt}/{MAX_READ_RETRIES}).{:else}Automatic retries paused. You can try again manually
      after the cooldown.{/if}
  </p>{/if}

<style>
  p {
    margin: 10px 0;
    color: var(--text-accent);
    font-size: 0.8rem;
    text-align: center;
  }
</style>

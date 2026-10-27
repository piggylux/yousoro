const attempts = new Map<string, { count: number; expiresAt: number }>();
export const MAX_READ_RETRIES = 2;
const WINDOW_MS = 10 * 60 * 1000;

export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const seconds =
    header && /^\d+$/.test(header)
      ? Number(header)
      : header
        ? (Date.parse(header) - now) / 1000
        : 60;
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60;
}

export function clearReadRetries(key: string) {
  attempts.delete(key);
}

/** Browser-only, bounded recovery for reads. Cancellation and hidden tabs never spend an attempt. */
export function queueReadRetry(key: string, retryAt: number, onretry: () => void) {
  const now = Date.now();
  for (const [name, entry] of attempts) if (entry.expiresAt <= now) attempts.delete(name);
  let entry = attempts.get(key);
  if (!entry) {
    if (attempts.size >= 100) return null;
    entry = { count: 0, expiresAt: Math.max(now, retryAt) + WINDOW_MS };
    attempts.set(key, entry);
  }
  if (entry.count >= MAX_READ_RETRIES || !(retryAt > 0)) return null;
  const budget = entry;
  budget.expiresAt = Math.max(budget.expiresAt, retryAt + WINDOW_MS);
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;
  const attempt = budget.count + 1;
  const stagger = [...key].reduce((sum, letter) => (sum + letter.charCodeAt(0)) % 5, 0) * 150;
  const deadline = retryAt + 250 + stagger;
  const run = () => {
    if (cancelled || document.hidden) return;
    if (Date.now() < deadline) {
      arm();
      return;
    }
    if (
      attempts.get(key) !== budget ||
      budget.count !== attempt - 1 ||
      budget.count >= MAX_READ_RETRIES
    ) {
      cancelled = true;
      document.removeEventListener('visibilitychange', visible);
      return;
    }
    cancelled = true;
    document.removeEventListener('visibilitychange', visible);
    budget.count++;
    onretry();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(run, Math.min(2 ** 31 - 1, Math.max(0, deadline - Date.now())));
  };
  const visible = () => {
    if (!document.hidden) run();
  };
  document.addEventListener('visibilitychange', visible);
  arm();
  return {
    attempt,
    cancel() {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}

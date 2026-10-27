/**
 * Confirmed saves keep the previous backlog and watched count until the card shows its new
 * progress. Cards may be replaced when they move, so feedback survives that replacement.
 */
type Counts = { backlog: number; progress: number };
const FEEDBACK_TTL_MS = 5000;
const countsBeforeSave = new Map<
  number,
  Counts & { confirmedProgress: number; expiresAt: number }
>();

export function rememberSavedCounts(id: number, before: Counts, confirmedProgress: number) {
  const now = Date.now();
  for (const [key, saved] of countsBeforeSave) {
    if (saved.expiresAt <= now) countsBeforeSave.delete(key);
  }
  if (confirmedProgress === before.progress) return;
  countsBeforeSave.set(id, { ...before, confirmedProgress, expiresAt: now + FEEDBACK_TTL_MS });
}

export function consumeSavedCounts(id: number, current: Counts) {
  const before = countsBeforeSave.get(id);
  if (!before) return null;
  if (before.expiresAt <= Date.now()) {
    countsBeforeSave.delete(id);
    return null;
  }
  // The old card can render again before its confirmed props arrive.
  if (current.progress !== before.confirmedProgress) return null;
  countsBeforeSave.delete(id);
  return {
    gain: Math.max(0, current.progress - before.progress),
    backlogDecreased: current.backlog < before.backlog,
    caughtUp: before.backlog > 0 && current.backlog === 0,
  };
}

import { createSubscriber } from 'svelte/reactivity';

const TICK_MS = 30_000;

let now = Date.now();

// The timer only runs while something on screen reads the clock, and never on the server
const subscribe = createSubscriber((update) => {
  now = Date.now();
  update();
  const timer = setInterval(() => {
    now = Date.now();
    update();
  }, TICK_MS);
  return () => clearInterval(timer);
});

/** The current time for countdowns, updated every 30 seconds while it's being displayed. */
export const clock = {
  get now() {
    subscribe();
    return now;
  },
};

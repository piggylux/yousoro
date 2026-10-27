import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackDayScroll } from './day-scroll.js';

afterEach(() => vi.unstubAllGlobals());

function dayLayout(contentHeight: number) {
  const attributes = new Set<string>();
  const observed = new Set<Element>();
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, () => void>();
  let nextFrame = 0;
  let resize = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(target: Element) {
        observed.add(target);
      }
      disconnect() {
        observed.clear();
      }
    }
  );
  const geometry = { contentHeight, scrollTop: 0 };
  const entries = Array.from({ length: 4 }, () => ({}) as Element);
  const lastEpisode = {
    getBoundingClientRect: () => ({ bottom: 100 + geometry.contentHeight - geometry.scrollTop }),
  };
  const list = {
    clientHeight: 400,
    // Padding alone must not enable a scrollbar or the More episodes control.
    get scrollHeight() {
      return geometry.contentHeight + 6;
    },
    get scrollTop() {
      return geometry.scrollTop;
    },
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => lastEpisode,
    querySelectorAll: () => entries,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const node = {
    querySelector: () => list,
    toggleAttribute: (name: string, value: boolean) =>
      value ? attributes.add(name) : attributes.delete(name),
  } as unknown as HTMLElement;
  const flush = () => {
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback(0);
    }
  };
  return {
    node,
    list,
    entries,
    attributes,
    observed,
    frames,
    listeners,
    geometry,
    flush,
    resize: () => resize(),
  };
}

describe('calendar day scrolling', () => {
  it('does not offer scrolling when four episodes fit despite trailing padding', () => {
    const day = dayLayout(398);
    const action = trackDayScroll(day.node, 4);
    day.flush();
    expect(day.list.scrollHeight).toBeGreaterThan(day.list.clientHeight);
    expect(day.attributes.has('data-scrollable')).toBe(false);
    day.geometry.contentHeight = 401.5;
    day.resize();
    day.flush();
    expect(day.attributes.has('data-scrollable')).toBe(false);
    action.destroy();
  });

  it('offers more episodes only for clipped content and switches to back to top at the end', () => {
    const day = dayLayout(600);
    const action = trackDayScroll(day.node, 6);
    day.flush();
    expect(day.attributes.has('data-scrollable')).toBe(true);
    expect(day.attributes.has('data-at-end')).toBe(false);
    day.geometry.scrollTop = 200;
    day.listeners.get('scroll')!();
    day.flush();
    expect(day.attributes.has('data-scrollable')).toBe(true);
    expect(day.attributes.has('data-at-end')).toBe(true);
    action.destroy();
  });

  it('remeasures episode size changes and observes replacement rows after an update', () => {
    const day = dayLayout(398);
    const action = trackDayScroll(day.node, 4);
    day.flush();
    expect(day.entries.every((entry) => day.observed.has(entry))).toBe(true);
    day.geometry.contentHeight = 450;
    day.resize();
    day.flush();
    expect(day.attributes.has('data-scrollable')).toBe(true);
    day.entries.splice(0, 4, {} as Element);
    day.geometry.contentHeight = 100;
    action.update();
    day.flush();
    expect(day.observed.has(day.entries[0])).toBe(true);
    expect(day.attributes.has('data-scrollable')).toBe(false);
    day.resize();
    action.destroy();
    expect(day.frames.size).toBe(0);
    expect(day.observed.size).toBe(0);
    expect(day.listeners.size).toBe(0);
  });
});

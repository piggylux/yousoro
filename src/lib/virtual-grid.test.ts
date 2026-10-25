import { describe, expect, it } from 'vitest';

import { countColumns, getVisibleRange } from '#lib/virtual-grid.js';

// 100 cards in 4 columns, so 25 rows, each 400px apart
const layout = { itemCount: 100, columns: 4, rowStride: 400, viewportHeight: 800, overscan: 1 };

describe('getVisibleRange', () => {
  it('renders the rows on screen plus the overscan, from the top', () => {
    // The grid starts 200px down: rows 0 and 1 are on screen, row 2 is the overscan
    expect(getVisibleRange({ ...layout, gridTop: 200 })).toEqual({
      start: 0,
      end: 12,
      paddingTop: 0,
      paddingBottom: 22 * 400,
    });
  });

  it('replaces the rows scrolled past with padding', () => {
    // Scrolled 4000px into the grid: rows 10 and 11 are on screen
    expect(getVisibleRange({ ...layout, gridTop: -4000 })).toEqual({
      start: 9 * 4,
      end: 13 * 4,
      paddingTop: 9 * 400,
      paddingBottom: 12 * 400,
    });
  });

  it('keeps the total height the same wherever the page is scrolled', () => {
    for (const gridTop of [300, 0, -1234, -5000, -9600, -20000]) {
      const range = getVisibleRange({ ...layout, gridTop });
      const renderedRows = Math.ceil((range.end - range.start) / layout.columns);
      expect(range.paddingTop + renderedRows * 400 + range.paddingBottom).toBe(25 * 400);
    }
  });

  it('stops at a short last row', () => {
    const range = getVisibleRange({ ...layout, itemCount: 98, gridTop: -9600 });
    expect(range.end).toBe(98);
    expect(range.paddingBottom).toBe(0);
  });

  it('renders nothing when the grid is far below the screen', () => {
    const range = getVisibleRange({ ...layout, gridTop: 5000 });
    expect(range.end - range.start).toBe(0);
    expect(range.paddingTop + range.paddingBottom).toBe(25 * 400);
  });
});

describe('countColumns', () => {
  it.each([
    [1000, 300, 24, 3],
    [948, 300, 24, 3],
    [947, 300, 24, 2],
    [200, 300, 24, 1],
  ])('a %ipx grid fits %ipx cards', (gridWidth, itemWidth, gap, expected) => {
    expect(countColumns(gridWidth, itemWidth, gap)).toBe(expected);
  });
});

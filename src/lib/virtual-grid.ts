/**
 * Virtual scrolling for a grid of same-sized cards: only the rows on or near the screen are
 * rendered, and padding above and below stands in for the others, so the page keeps its height.
 */
export type GridLayout = {
  itemCount: number;
  columns: number;
  /** A row's height plus the gap below it */
  rowStride: number;
  /** Where the grid starts, relative to the top of the viewport (negative once scrolled past) */
  gridTop: number;
  viewportHeight: number;
  /** Rows rendered beyond each edge of the screen, so fast scrolling doesn't show blank space */
  overscan?: number;
};

export type VisibleRange = {
  /** The items to render: from `start`, up to but not including `end` */
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
};

export function getVisibleRange({
  itemCount,
  columns,
  rowStride,
  gridTop,
  viewportHeight,
  overscan = 2,
}: GridLayout): VisibleRange {
  const rows = Math.ceil(itemCount / columns);
  const clamp = (row: number) => Math.min(Math.max(row, 0), rows);

  const firstRow = clamp(Math.floor(-gridTop / rowStride) - overscan);
  const lastRow = Math.max(
    firstRow,
    clamp(Math.ceil((viewportHeight - gridTop) / rowStride) + overscan)
  );

  return {
    start: firstRow * columns,
    end: Math.min(lastRow * columns, itemCount),
    paddingTop: firstRow * rowStride,
    paddingBottom: (rows - lastRow) * rowStride,
  };
}

/** How many cards of `itemWidth` fit side by side in `gridWidth`, with `gap` between them */
export function countColumns(gridWidth: number, itemWidth: number, gap: number) {
  return Math.max(1, Math.floor((gridWidth + gap) / (itemWidth + gap)));
}

/*
 * Draws the app icons in static/ from the anchor in the header: `bun run icons`.
 *
 * Each platform frames an icon differently, so the anchor is drawn on a solid tile in three ways:
 * - iOS fills a home-screen icon's corners with black where it's transparent, then rounds them
 *   itself, so its icon is a full square
 * - Android crops a maskable icon to its launcher's shape, which can cut anything outside a centred
 *   circle 80% as wide, so the anchor keeps well inside it. Without one, it shrinks the plain icon
 *   onto a white disc
 * - Browser tabs and desktop installs show the plain icon as it is, so its tile has rounded corners,
 *   and a tab's anchor is drawn larger and bolder to stay legible at 16 pixels
 */
import { writeFile } from 'node:fs/promises';

import sharp from 'sharp';

/** --you-blue in src/app.css's light theme, the colour of the header's anchor and wordmark */
const BLUE = '#2463a6';

/**
 * The header's anchor on a 24-unit grid. Its lines keep within a circle 20 units across around the
 * grid's centre, which its strokes widen by their own width
 */
const ANCHOR = `
  <circle cx="12" cy="5" r="3" />
  <path d="M12 22V8" />
  <path d="M8 11h8" />
  <path d="M5 12H2a10 10 0 0 0 20 0h-3" />`;

type Framing = {
  /** How round the tile's corners are, as a share of its width */
  corner: number;
  /** How wide the anchor is, as a share of the tile's width */
  anchor: number;
  /** The anchor's stroke, in grid units; the header's is 2 */
  stroke: number;
};

/** A full square: iOS rounds it, and Android crops it to the launcher's shape */
const FULL: Framing = { corner: 0, anchor: 0.58, stroke: 2 };
/** A rounded tile, for desktop installs and launchers that don't crop icons */
const TILE: Framing = { corner: 0.22, anchor: 0.58, stroke: 2 };
/** A favicon's anchor fills more of its tile, with a heavier stroke */
const FAVICON: Framing = { corner: 0.2, anchor: 0.82, stroke: 2.5 };

function svg(size: number, { corner, anchor, stroke }: Framing): string {
  // The anchor's extent grows with the stroke, so it's scaled to its outer edge
  const scale = (anchor * size) / (20 + stroke);
  const half = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${corner * size}" fill="${BLUE}" />
  <g transform="translate(${half} ${half}) scale(${scale}) translate(-12 -12)" fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ANCHOR}
  </g>
</svg>`;
}

function png(size: number, framing: Framing): Promise<Buffer> {
  return sharp(Buffer.from(svg(size, framing)))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An ICO file of PNG images, which every browser that still asks for /favicon.ico reads */
function ico(images: readonly { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    // A width or height of 256 is written as 0
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const favicon = async (size: number) => ({ size, data: await png(size, FAVICON) });
const favicons = [await favicon(16), await favicon(32), await favicon(48)] as const;
const files: Record<string, Buffer> = {
  'favicon.ico': ico(favicons),
  'favicon-16x16.png': favicons[0].data,
  'favicon-32x32.png': favicons[1].data,
  'apple-touch-icon.png': await png(180, FULL),
  'android-chrome-192x192.png': await png(192, TILE),
  'android-chrome-512x512.png': await png(512, TILE),
  'maskable-512x512.png': await png(512, FULL),
};
for (const [name, data] of Object.entries(files)) {
  await writeFile(new URL(`../static/${name}`, import.meta.url), data);
}

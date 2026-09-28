// Works out where an icon's artwork sits, so the maskable version can be laid
// out properly. Pure pixel maths with no DOM, so it can be unit tested.

/** RGBA pixels, as in `ImageData`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface IconLayout {
  /** The icon's own opaque background colour (`#rrggbb`), if it has one. */
  background?: string;
  /** Centre of the artwork, as a fraction of the width and height. */
  cx: number;
  cy: number;
  /** Distance from the centre to the furthest artwork pixel, as a fraction of the width. */
  radius: number;
}

/** Maskable icons must keep everything that matters inside this circle (radius, fraction of size). */
export const SAFE_ZONE_RADIUS = 0.4;

const OPAQUE = 250;
/** Sum of RGB differences below which two colours count as the same. */
const SAME_COLOUR = 48;

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function analyseIcon({ data, width, height }: Pixels): IconLayout {
  const at = (x: number, y: number) => (y * width + x) * 4;
  const diff = (i: number, rgb: number[]) =>
    Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]);

  // An icon whose four corners are the same opaque colour, like an Apple touch
  // icon, is artwork drawn on a background. Anything else has none.
  const inset = Math.min(1, width - 1, height - 1);
  const corners = [at(inset, inset), at(width - 1 - inset, inset), at(inset, height - 1 - inset), at(width - 1 - inset, height - 1 - inset)];
  const first = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  const solid = corners.every((i) => data[i + 3] >= OPAQUE && diff(i, first) < SAME_COLOUR);
  const bg = solid
    ? [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + data[i + c], 0) / corners.length)
    : undefined;

  const isArt = (i: number) => (bg ? data[i + 3] >= 128 && diff(i, bg) >= SAME_COLOUR : data[i + 3] > 24);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isArt(at(x, y))) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const background = bg && `#${bg.map(hex).join('')}`;
  // A blank icon, or one that is a single flat colour: treat the whole square as artwork.
  if (maxX < 0) return { background, cx: 0.5, cy: 0.5, radius: Math.SQRT1_2 };

  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  let furthest = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isArt(at(x, y))) continue;
      // Pixel corners, so a one-pixel dot still has a size.
      const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx));
      const dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy));
      furthest = Math.max(furthest, dx * dx + dy * dy);
    }
  }
  return { background, cx: cx / width, cy: cy / height, radius: Math.sqrt(furthest) / width };
}

/**
 * How much to scale the icon, relative to filling the canvas, so its artwork
 * fits the maskable safe zone. Capped so a tiny glyph isn't blown up to mush.
 */
export function maskableScale(layout: IconLayout): number {
  return Math.min(SAFE_ZONE_RADIUS / layout.radius, 3);
}

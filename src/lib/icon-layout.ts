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
  /**
   * The square that background covers, when the icon draws its artwork on one:
   * the whole image, or a rounded square with transparent corners, like
   * Messenger's. Centre and size as fractions of the width.
   */
  plate?: { cx: number; cy: number; size: number };
  /** The background reaches all four corners: a full-bleed square like an Apple touch icon. */
  fullBleed?: boolean;
  /**
   * Centre the artwork is measured from, as a fraction of the width and
   * height: the plate's centre if there is one, else the artwork's own.
   */
  cx: number;
  cy: number;
  /** Distance from that centre to the furthest artwork pixel, as a fraction of the width. */
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

  const sameColour = (points: number[]) => {
    const rgb = [data[points[0]], data[points[0] + 1], data[points[0] + 2]];
    return points.every((i) => data[i + 3] >= OPAQUE && diff(i, rgb) < SAME_COLOUR);
  };
  const average = (points: number[]) => [0, 1, 2].map((c) => points.reduce((sum, i) => sum + data[i + c], 0) / points.length);

  // An icon whose four corners are the same opaque colour, like an Apple touch
  // icon, is artwork drawn on a background filling the image.
  const inset = Math.min(1, width - 1, height - 1);
  const corners = [at(inset, inset), at(width - 1 - inset, inset), at(inset, height - 1 - inset), at(width - 1 - inset, height - 1 - inset)];
  let bg: number[] | undefined;
  let plate: IconLayout['plate'];
  const fullBleed = sameColour(corners);
  if (fullBleed) {
    bg = average(corners);
    plate = { cx: 0.5, cy: 0.5, size: 1 };
  } else {
    plate = findPlate({ data, width, height });
    if (plate) {
      // Just inside the plate's edges, halfway along each side.
      const half = (plate.size * width) / 2 - Math.max(2, Math.round(width * 0.03));
      const px = plate.cx * width;
      const py = plate.cy * height;
      const sides = [at(Math.round(px - half), Math.round(py)), at(Math.round(px + half), Math.round(py)), at(Math.round(px), Math.round(py - half)), at(Math.round(px), Math.round(py + half))];
      if (sameColour(sides)) bg = average(sides);
      else plate = undefined;
    }
  }

  // With a plate, only what's drawn on it counts, which is opaque like the
  // plate; not a translucent drop shadow showing past its rounded corners.
  const onPlate = (x: number, y: number) =>
    !plate || (Math.abs(x + 0.5 - plate.cx * width) <= (plate.size * width) / 2 && Math.abs(y + 0.5 - plate.cy * height) <= (plate.size * width) / 2);
  const isArtPixel = (i: number) =>
    plate ? data[i + 3] >= OPAQUE && diff(i, bg!) >= SAME_COLOUR : bg ? data[i + 3] >= 128 && diff(i, bg) >= SAME_COLOUR : data[i + 3] > 24;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!onPlate(x, y) || !isArtPixel(at(x, y))) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const background = bg && `#${bg.map(hex).join('')}`;
  // A blank icon, or one that is a single flat colour: treat the whole square as artwork.
  const base = { background, plate, ...(fullBleed && { fullBleed }) };
  if (maxX < 0) return { ...base, cx: 0.5, cy: 0.5, radius: Math.SQRT1_2 };

  // Measuring from the plate's centre keeps lopsided artwork, like a speech
  // bubble's tail, where the designer put it.
  const cx = plate ? plate.cx * width : (minX + maxX + 1) / 2;
  const cy = plate ? plate.cy * height : (minY + maxY + 1) / 2;
  let furthest = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!onPlate(x, y) || !isArtPixel(at(x, y))) continue;
      // Pixel corners, so a one-pixel dot still has a size.
      const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx));
      const dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy));
      furthest = Math.max(furthest, dx * dx + dy * dy);
    }
  }
  return { ...base, cx: cx / width, cy: cy / height, radius: Math.sqrt(furthest) / width };
}

/**
 * The opaque rounded square an icon is drawn on, if it has one: opaque pixels
 * spanning most of the image (a macOS-style icon's plate spans about 80%) and
 * filling their bounding box the way a rounded square does. A circle fills
 * only 79% of its box, so round logos don't count.
 */
function findPlate({ data, width, height }: Pixels): IconLayout['plate'] {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < OPAQUE) continue;
      opaque++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w < width * 0.6 || h < height * 0.6 || opaque < w * h * 0.88) return undefined;
  return { cx: (minX + maxX + 1) / 2 / width, cy: (minY + maxY + 1) / 2 / height, size: Math.max(w, h) / width };
}

export interface Placement {
  /** Scale relative to the image filling the canvas. */
  scale: number;
  /** Point of the image, as fractions of its size, to put at the canvas centre. */
  cx: number;
  cy: number;
}

/**
 * Where to draw the image in a maskable icon.
 *
 * - A full-bleed square (opaque corners, like an Apple touch icon) is already
 *   designed to be cropped by iOS and macOS, so it is used as it is.
 * - A rounded-square plate is enlarged to fill the canvas, keeping the artwork
 *   at its designed size and position, and shrunk about the plate's centre
 *   only if the artwork would poke out of the safe zone.
 * - Artwork with no background is scaled to fill the safe zone, capped so a
 *   tiny glyph isn't blown up to mush.
 */
export function maskablePlacement(layout: IconLayout): Placement {
  const { plate } = layout;
  if (layout.fullBleed) return { scale: 1, cx: 0.5, cy: 0.5 };
  const fitSafeZone = SAFE_ZONE_RADIUS / layout.radius;
  if (!plate) return { scale: Math.min(fitSafeZone, 3), cx: layout.cx, cy: layout.cy };
  return { scale: Math.min(1 / plate.size, fitSafeZone), cx: plate.cx, cy: plate.cy };
}

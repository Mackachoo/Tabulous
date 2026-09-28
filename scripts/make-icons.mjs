// Draws the extension icon (an app window with tabs) as PNGs with no
// dependencies. Run with `node scripts/make-icons.mjs`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // supersampling per axis for anti-aliasing

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const TOP = [92, 118, 255];
const BOTTOM = [58, 62, 214];
const WHITE = [255, 255, 255];

/** RGBA colour of the icon at unit coordinates (x, y). */
function shade(x, y) {
  if (!inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  let rgb = mix(TOP, BOTTOM, y);
  const layers = [
    // inactive tab, active tab, window body
    { rect: [0.5, 0.23, 0.78, 0.36, 0.05], alpha: 0.55 },
    { rect: [0.2, 0.19, 0.5, 0.36, 0.05], alpha: 1 },
    { rect: [0.2, 0.31, 0.8, 0.8, 0.07], alpha: 1 },
  ];
  for (const { rect, alpha } of layers) {
    if (inRoundRect(x, y, ...rect)) rgb = mix(rgb, WHITE, alpha);
  }
  // Content lines inside the window.
  if (inRoundRect(x, y, 0.3, 0.45, 0.7, 0.51, 0.03) || inRoundRect(x, y, 0.3, 0.59, 0.58, 0.65, 0.03)) {
    rgb = mix(TOP, BOTTOM, y);
  }
  return [...rgb, 255];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          // Premultiply so transparent edges don't darken.
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const i = (y * size + x) * 4;
      const a = acc[3] / SAMPLES ** 2;
      px[i] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      px[i + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      px[i + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      px[i + 3] = Math.round(a);
    }
  }
  return png(size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of SIZES) writeFileSync(`public/icons/icon-${size}.png`, render(size));
console.log(`Wrote ${SIZES.map((s) => `icon-${s}.png`).join(', ')}`);

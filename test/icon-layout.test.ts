import { describe, expect, it } from 'vitest';
import { analyseIcon, maskablePlacement, SAFE_ZONE_RADIUS } from '../src/lib/icon-layout';

type RGBA = [number, number, number, number];

/** A size×size icon coloured pixel by pixel. */
function pixels(size: number, colour: (x: number, y: number) => RGBA) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data.set(colour(x, y), (y * size + x) * 4);
  }
  return { data, width: size, height: size };
}

const WHITE: RGBA = [255, 255, 255, 255];
const BLUE: RGBA = [8, 102, 255, 255];
const CLEAR: RGBA = [0, 0, 0, 0];
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
/** A rounded square from `from` to `to` (exclusive) with corner radius `r`. */
const inRoundedSquare = (x: number, y: number, from: number, to: number, r: number) => {
  if (x < from || y < from || x >= to || y >= to) return false;
  const nx = Math.min(Math.max(x + 0.5, from + r), to - r);
  const ny = Math.min(Math.max(y + 0.5, from + r), to - r);
  return (x + 0.5 - nx) ** 2 + (y + 0.5 - ny) ** 2 <= r * r;
};

describe('analyseIcon', () => {
  it('finds the background and artwork of an icon drawn on a square, like Messenger’s', () => {
    // Blue circle, 84% of the width, on white.
    const layout = analyseIcon(pixels(100, (x, y) => (inCircle(x, y, 50, 50, 42) ? BLUE : WHITE)));
    expect(layout.background).toBe('#ffffff');
    expect(layout.cx).toBeCloseTo(0.5, 2);
    expect(layout.cy).toBeCloseTo(0.5, 2);
    expect(layout.radius).toBeGreaterThan(0.41);
    expect(layout.radius).toBeLessThan(0.44);
  });

  it('has no background when the corners are transparent', () => {
    const layout = analyseIcon(pixels(100, (x, y) => (inCircle(x, y, 50, 50, 30) ? BLUE : CLEAR)));
    expect(layout.background).toBeUndefined();
    expect(layout.radius).toBeCloseTo(0.3, 1);
  });

  it('measures off-centre artwork from its own centre', () => {
    const layout = analyseIcon(pixels(100, (x, y) => (inCircle(x, y, 30, 70, 10) ? BLUE : WHITE)));
    expect(layout.cx).toBeCloseTo(0.3, 1);
    expect(layout.cy).toBeCloseTo(0.7, 1);
    expect(layout.radius).toBeCloseTo(0.1, 1);
  });

  it('treats a flat square as all artwork', () => {
    const layout = analyseIcon(pixels(10, () => BLUE));
    expect(layout.radius).toBeCloseTo(Math.SQRT1_2);
  });

  it('finds a rounded-square plate with transparent corners, like Messenger’s icon', () => {
    // White rounded square filling the image, blue circle on it.
    const layout = analyseIcon(
      pixels(100, (x, y) => (inCircle(x, y, 50, 50, 30) ? BLUE : inRoundedSquare(x, y, 2, 98, 20) ? WHITE : CLEAR)),
    );
    expect(layout.background).toBe('#ffffff');
    expect(layout.plate?.size).toBeCloseTo(0.96, 2);
    expect(layout.radius).toBeCloseTo(0.3, 1);
  });

  it('doesn’t take a round logo for a plate', () => {
    const layout = analyseIcon(pixels(100, (x, y) => (inCircle(x, y, 50, 50, 50) ? BLUE : CLEAR)));
    expect(layout.plate).toBeUndefined();
    expect(layout.background).toBeUndefined();
  });
});

describe('maskablePlacement', () => {
  it('enlarges a plate to fill the icon, keeping the artwork at its designed size', () => {
    const placement = maskablePlacement({ background: '#ffffff', plate: { cx: 0.5, cy: 0.5, size: 0.8 }, cx: 0.5, cy: 0.5, radius: 0.25 });
    expect(placement.scale).toBeCloseTo(1.25);
  });

  it('shrinks artwork on a plate only as far as the safe zone', () => {
    const placement = maskablePlacement({ background: '#ffffff', plate: { cx: 0.5, cy: 0.5, size: 1 }, cx: 0.5, cy: 0.52, radius: 0.45 });
    expect(placement.scale).toBeCloseTo(SAFE_ZONE_RADIUS / 0.45);
    expect(placement.cy).toBe(0.52);
  });

  it('fills the safe zone with artwork that has no background, within limits', () => {
    expect(maskablePlacement({ cx: 0.5, cy: 0.5, radius: 0.5 }).scale).toBeCloseTo(SAFE_ZONE_RADIUS / 0.5);
    expect(maskablePlacement({ cx: 0.5, cy: 0.5, radius: 0.2 }).scale).toBeCloseTo(2);
    expect(maskablePlacement({ cx: 0.5, cy: 0.5, radius: 0.01 }).scale).toBe(3);
  });
});

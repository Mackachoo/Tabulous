// Turns site icons (or an uploaded image) into PNG data: URLs. A data: manifest
// has no base URL, and Chrome may not be able to fetch the site's icons with
// the right cookies, so the icons are embedded, as betterPWAs does.
// Runs in extension pages (popup/options), which need a DOM for decoding.

import type { IconCandidate } from './detect';
import { analyseIcon, maskablePlacement, type IconLayout } from './icon-layout';
import type { ManifestIcon } from './web-manifest';

const OUTPUT_SIZES = [192, 512];

const SOURCE_RANK: Record<IconCandidate['source'], number> = {
  manifest: 3,
  'apple-touch-icon': 2,
  'link-icon': 1,
  favicon: 0,
};

/** Best candidates first: explicit `any` icons, then larger, then better sources. */
export function rankCandidates(candidates: IconCandidate[]): IconCandidate[] {
  const isVector = (c: IconCandidate) => /\.svg($|\?)/i.test(c.url);
  const score = (c: IconCandidate) =>
    (c.purpose?.includes('maskable') && !c.purpose.includes('any') ? -10_000 : 0) +
    (isVector(c) ? 1024 : c.size) +
    SOURCE_RANK[c.source];
  return [...candidates].sort((a, b) => score(b) - score(a));
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws `img` fitted, without stretching, into the square at (x, y). SVGs with no intrinsic size report 0×0. */
function drawFitted(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, size: number): void {
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;
  const scale = Math.min(size / w, size / h);
  ctx.drawImage(img, x + (size - w * scale) / 2, y + (size - h * scale) / 2, w * scale, h * scale);
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const ctx = el.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  return [el, ctx];
}

function render(img: HTMLImageElement, size: number): string {
  const [el, ctx] = canvas(size);
  drawFitted(ctx, img, 0, 0, size);
  return el.toDataURL('image/png');
}

function layoutOf(img: HTMLImageElement): IconLayout {
  const size = 128;
  const [, ctx] = canvas(size);
  drawFitted(ctx, img, 0, 0, size);
  return analyseIcon(ctx.getImageData(0, 0, size, size));
}

/**
 * Chrome crops maskable icons to any shape that contains the central safe-zone
 * circle (on macOS, the Dock's rounded square). So the canvas is filled edge
 * to edge with the icon's own background (or `fallback` if it has none) and
 * the image is placed by `maskablePlacement`, rather than shrinking the whole
 * image, background and all.
 */
function renderMaskable(img: HTMLImageElement, size: number, layout: IconLayout, fallback: string): string {
  const [el, ctx] = canvas(size);
  ctx.fillStyle = layout.background ?? fallback;
  ctx.fillRect(0, 0, size, size);
  const { scale, cx, cy } = maskablePlacement(layout);
  const frame = size * scale;
  drawFitted(ctx, img, size / 2 - cx * frame, size / 2 - cy * frame, frame);
  return el.toDataURL('image/png');
}

/**
 * Square PNG icons at every output size, plus a maskable one. `background`
 * fills the maskable icon when the image has no background of its own.
 */
export async function blobToIcons(blob: Blob, background = '#ffffff'): Promise<ManifestIcon[]> {
  const img = await loadImage(blob);
  const icons: ManifestIcon[] = OUTPUT_SIZES.map((size) => ({
    src: render(img, size),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any',
  }));
  icons.push({
    src: renderMaskable(img, 512, layoutOf(img), background),
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  });
  return icons;
}

export interface IconResult {
  icons: ManifestIcon[];
  /** The candidate the icons were made from. */
  from?: IconCandidate;
  failed: string[];
}

/**
 * Icon CDNs often answer `Access-Control-Allow-Origin: *`, which browsers
 * refuse for credentialed requests, so a failed fetch is retried without cookies.
 */
async function fetchIcon(url: string): Promise<Blob> {
  for (const credentials of ['include', 'omit'] as const) {
    try {
      const res = await fetch(url, { credentials });
      if (res.ok) return await res.blob();
    } catch {
      // Try the next credentials mode.
    }
  }
  throw new Error(`Couldn't download ${url}`);
}

/** Tries candidates best-first until one can be fetched and decoded. */
export async function iconsFromCandidates(candidates: IconCandidate[], background?: string): Promise<IconResult> {
  const failed: string[] = [];
  for (const candidate of rankCandidates(candidates)) {
    try {
      const icons = await blobToIcons(await fetchIcon(candidate.url), background);
      return { icons, from: candidate, failed };
    } catch {
      failed.push(candidate.url);
    }
  }
  return { icons: [], failed };
}

export interface SiteRead {
  candidates: IconCandidate[];
  /** The site's own manifest and its URL, when it has one that could be read. */
  manifest?: Record<string, unknown>;
  manifestUrl?: string;
}

/**
 * Icon candidates and the site's own manifest from a page's HTML, for the
 * editor, which has no tab to inspect. Reads the HTML as served, so it finds the
 * site's manifest even while Tabulous's has replaced it in open tabs.
 * Needs host permission for the site.
 */
export async function readSite(pageUrl: string): Promise<SiteRead> {
  const res = await fetch(pageUrl, { credentials: 'include' });
  const base = res.url || pageUrl;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const abs = (href: string, from = base) => new URL(href, from).href;
  const maxSize = (sizes: string | null | undefined) =>
    Math.max(0, ...(sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0));

  const candidates: IconCandidate[] = [];
  let manifest: Record<string, unknown> | undefined;
  let manifestUrl: string | undefined;
  const manifestHref = doc.querySelector<HTMLLinkElement>('link[rel~="manifest"]')?.getAttribute('href');
  if (manifestHref) {
    manifestUrl = abs(manifestHref);
    try {
      manifest = (await (await fetch(manifestUrl, { credentials: 'include' })).json()) as Record<string, unknown>;
      for (const icon of (manifest.icons ?? []) as { src?: string; sizes?: string; purpose?: string }[]) {
        if (icon.src) {
          candidates.push({ url: abs(icon.src, manifestUrl), size: maxSize(icon.sizes), purpose: icon.purpose, source: 'manifest' });
        }
      }
    } catch {
      // Unreadable manifest; fall back to <link> icons.
    }
  }
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel~="apple-touch-icon"]'))) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const apple = link.rel.includes('apple-touch-icon');
    candidates.push({
      url: abs(href),
      size: maxSize(link.getAttribute('sizes')) || (apple ? 180 : 0),
      source: apple ? 'apple-touch-icon' : 'link-icon',
    });
  }
  candidates.push({ url: abs('/favicon.ico'), size: 0, source: 'favicon' });
  return { candidates, manifest, manifestUrl: manifest && manifestUrl };
}

export function largestIcon(icons: ManifestIcon[]): ManifestIcon | undefined {
  const size = (i: ManifestIcon) => parseInt(i.sizes ?? '0', 10) || 0;
  return [...icons].filter((i) => i.purpose !== 'maskable').sort((a, b) => size(b) - size(a))[0];
}

/** The icon Chrome on macOS puts in the Dock: the maskable one, used full-bleed. */
export function dockIcon(icons: ManifestIcon[]): ManifestIcon | undefined {
  return icons.find((i) => i.purpose?.split(/\s+/).includes('maskable')) ?? largestIcon(icons);
}

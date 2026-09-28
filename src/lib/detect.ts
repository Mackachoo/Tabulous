// Page inspection run with chrome.scripting.executeScript({ func: inspectPage }).
// The function is serialised into the page, so it must not reference anything
// outside its own body (no imports, no helpers).

export interface IconCandidate {
  url: string;
  /** Largest declared edge in px, 0 if unknown (e.g. SVG or no `sizes`). */
  size: number;
  purpose?: string;
  source: 'manifest' | 'apple-touch-icon' | 'link-icon' | 'favicon';
}

export interface PageInfo {
  url: string;
  origin: string;
  title: string;
  themeColor?: string;
  /** The site's own manifest, if it has one and it isn't Appify's. */
  siteManifestUrl?: string;
  siteManifest?: Record<string, unknown>;
  appifyManifestPresent: boolean;
  icons: IconCandidate[];
  /** The page's CSP would block a data: manifest. */
  cspBlocksManifest: boolean;
  /** `display-mode` the page is running in: browser, standalone, tabbed… */
  displayMode: string;
}

export async function inspectPage(): Promise<PageInfo> {
  const maxSize = (sizes: string | null | undefined) =>
    Math.max(0, ...(sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0));

  const icons: IconCandidate[] = [];
  let siteManifestUrl: string | undefined;
  let siteManifest: Record<string, unknown> | undefined;
  let appifyManifestPresent = false;

  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="manifest"]'))) {
    if (link.dataset.appify !== undefined) {
      appifyManifestPresent = true;
      continue;
    }
    if (siteManifestUrl) continue;
    siteManifestUrl = link.href;
    try {
      const res = await fetch(link.href, { credentials: link.crossOrigin === 'use-credentials' ? 'include' : 'same-origin' });
      if (res.ok) siteManifest = await res.json();
    } catch {
      // Cross-origin manifest without CORS; the popup can still build one.
    }
  }

  const manifestIcons = (siteManifest?.icons as { src?: string; sizes?: string; purpose?: string }[] | undefined) ?? [];
  for (const icon of manifestIcons) {
    if (!icon.src || !siteManifestUrl) continue;
    icons.push({
      url: new URL(icon.src, siteManifestUrl).href,
      size: maxSize(icon.sizes),
      purpose: icon.purpose,
      source: 'manifest',
    });
  }
  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'))) {
    if (!link.href) continue;
    const apple = link.rel.includes('apple-touch-icon');
    icons.push({
      url: link.href,
      // Apple touch icons without `sizes` are conventionally 180px.
      size: maxSize(link.getAttribute('sizes')) || (apple ? 180 : 0),
      source: apple ? 'apple-touch-icon' : 'link-icon',
    });
  }
  icons.push({ url: new URL('/favicon.ico', location.origin).href, size: 0, source: 'favicon' });

  const seen = new Set<string>();
  const uniqueIcons = icons.filter((i) => !seen.has(i.url) && seen.add(i.url));

  // A data: manifest is governed by manifest-src, falling back to default-src.
  const blocks = (policy: string) => {
    const directives = new Map(
      policy
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((parts) => parts[0])
        .map((parts) => [parts[0].toLowerCase(), parts.slice(1)] as const),
    );
    const sources = directives.get('manifest-src') ?? directives.get('default-src');
    return Boolean(sources && !sources.includes('data:') && !sources.includes('*'));
  };
  const policies: string[] = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy" i]'),
  ).map((m) => m.content);
  try {
    const res = await fetch(location.href, { method: 'HEAD', credentials: 'include', cache: 'no-store' });
    const header = res.headers.get('content-security-policy');
    if (header) policies.push(...header.split(','));
  } catch {
    // Some sites reject HEAD; the content script still reports real violations.
  }

  const displayModes = ['tabbed', 'window-controls-overlay', 'fullscreen', 'standalone', 'minimal-ui'];
  const displayMode = displayModes.find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? 'browser';

  return {
    url: location.href,
    origin: location.origin,
    title: (siteManifest?.name as string | undefined) ?? document.title,
    themeColor:
      (siteManifest?.theme_color as string | undefined) ??
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ??
      undefined,
    siteManifestUrl,
    siteManifest,
    appifyManifestPresent,
    icons: uniqueIcons,
    cspBlocksManifest: policies.some(blocks),
    displayMode,
  };
}

/**
 * Downloads icons from inside the page (executeScript with `args: [urls]`), so
 * they come with the site's own cookies and CORS access and need no host
 * permission. Returns data: URLs in the same order, skipping failures.
 * Serialised into the page like `inspectPage`.
 */
export async function fetchIconsInPage(urls: string[]): Promise<{ url: string; dataUrl: string }[]> {
  const fetched = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return { url, dataUrl };
      } catch {
        return undefined;
      }
    }),
  );
  return fetched.filter((f): f is { url: string; dataUrl: string } => Boolean(f));
}

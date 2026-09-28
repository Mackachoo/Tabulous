// Types for the parts of the Web App Manifest Tabulous writes, plus the builder
// that turns a user's SiteConfig into the manifest injected into the page.

export type Display = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';
export type DisplayOverride = Display | 'tabbed' | 'window-controls-overlay';
export type LaunchClientMode = 'auto' | 'focus-existing' | 'navigate-existing' | 'navigate-new';

export interface ManifestIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

/** A URLPatternInit as Chrome accepts it in `tab_strip.home_tab.scope_patterns`. */
export interface ScopePattern {
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

export interface TabStrip {
  home_tab?: { scope_patterns: ScopePattern[] };
  new_tab_button?: { url: string };
}

export interface WebAppManifest {
  id: string;
  name: string;
  short_name?: string;
  start_url: string;
  scope: string;
  display: Display;
  display_override?: DisplayOverride[];
  tab_strip?: TabStrip;
  theme_color?: string;
  background_color?: string;
  icons: ManifestIcon[];
  launch_handler?: { client_mode: LaunchClientMode };
  shortcuts?: { name: string; url: string }[];
  [extra: string]: unknown;
}

export interface Shortcut {
  name: string;
  /** Path on the site's origin, e.g. `/compose`. */
  path: string;
}

/** Everything the user can configure for one site. Stored per origin. */
export interface SiteConfig {
  /** e.g. `https://www.messenger.com` */
  origin: string;
  enabled: boolean;
  name: string;
  shortName?: string;
  /** Page the app opens on. Path on `origin`. */
  startPath: string;
  /** Everything under this path counts as "in the app" (no URL bar). */
  scopePath: string;
  themeColor?: string;
  backgroundColor?: string;
  /** Icons with data: URL sources, so they work from a data: manifest. */
  icons: ManifestIcon[];
  tabbed: boolean;
  /** URLPattern pathnames that belong to the pinned home tab, e.g. `/inbox/*`. */
  homeTabPaths: string[];
  /** Path the tab strip's new tab button opens. */
  newTabPath?: string;
  launchMode: LaunchClientMode;
  shortcuts: Shortcut[];
  /** Remove the site's CSP header so the data: manifest isn't blocked. */
  cspBypass: boolean;
  /** Raw manifest members merged over the generated manifest. */
  overrides: Record<string, unknown>;
  updatedAt: number;
}

export function defaultSiteConfig(origin: string, partial: Partial<SiteConfig> = {}): SiteConfig {
  return {
    origin,
    enabled: true,
    name: new URL(origin).hostname.replace(/^www\./, ''),
    startPath: '/',
    scopePath: '/',
    icons: [],
    tabbed: true,
    homeTabPaths: [],
    newTabPath: undefined,
    launchMode: 'auto',
    shortcuts: [],
    cspBypass: false,
    overrides: {},
    updatedAt: Date.now(),
    ...partial,
  };
}

/** Normalises user input like `example.com` or `https://example.com/foo` to an origin. */
export function toOrigin(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Only http(s) sites can be apps, not ${url.protocol}`);
  }
  return url.origin;
}

/** Resolves a path against the site origin. Full URLs on the same origin are accepted too. */
export function absoluteUrl(origin: string, path: string): string {
  const url = new URL(path || '/', origin + '/');
  if (url.origin !== origin) {
    throw new Error(`${path} is not on ${origin}`);
  }
  return url.href;
}

/** Scope must be a directory-like prefix; `/t` would otherwise also match `/terms`. */
export function normaliseScopePath(path: string): string {
  let p = path.trim() || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p;
}

export function scopePattern(origin: string, pathname: string): ScopePattern {
  const url = new URL(origin);
  // Every component is spelled out. The manifest is a data: URL, so anything
  // Chrome inherited from the manifest's base URL would never match the site.
  return {
    protocol: url.protocol.replace(':', ''),
    hostname: url.hostname,
    port: url.port,
    pathname,
    search: '*',
    hash: '*',
  };
}

/** Stable per origin, so Chrome treats every injected copy as the same app. */
export function appId(origin: string): string {
  return absoluteUrl(origin, '/?tabulous');
}

export function buildManifest(config: SiteConfig): WebAppManifest {
  const { origin } = config;
  const scope = absoluteUrl(origin, normaliseScopePath(config.scopePath));

  const manifest: WebAppManifest = {
    id: appId(origin),
    name: config.name,
    start_url: absoluteUrl(origin, config.startPath),
    scope,
    display: 'standalone',
    // Without the tab strip flags Chrome skips `tabbed` and uses `standalone`.
    display_override: config.tabbed ? ['tabbed', 'standalone'] : ['standalone'],
    icons: config.icons,
  };

  if (config.shortName) manifest.short_name = config.shortName;
  if (config.themeColor) manifest.theme_color = config.themeColor;
  if (config.backgroundColor) manifest.background_color = config.backgroundColor;
  if (config.launchMode !== 'auto') manifest.launch_handler = { client_mode: config.launchMode };

  if (config.tabbed) {
    const tabStrip: TabStrip = {};
    const homePaths = config.homeTabPaths.map((p) => p.trim()).filter(Boolean);
    if (homePaths.length) {
      tabStrip.home_tab = { scope_patterns: homePaths.map((p) => scopePattern(origin, p)) };
    }
    if (config.newTabPath?.trim()) {
      tabStrip.new_tab_button = { url: absoluteUrl(origin, config.newTabPath) };
    }
    if (Object.keys(tabStrip).length) manifest.tab_strip = tabStrip;
  }

  const shortcuts = config.shortcuts.filter((s) => s.name.trim() && s.path.trim());
  if (shortcuts.length) {
    manifest.shortcuts = shortcuts.map((s) => ({ name: s.name, url: absoluteUrl(origin, s.path) }));
  }

  return { ...manifest, ...config.overrides };
}

export interface ScopeCheck {
  inScope: boolean;
  homeTab: boolean;
}

/** What Chrome will do with `url` in the installed app: keep it in the app, and which tab. */
export function checkUrl(config: SiteConfig, url: string): ScopeCheck {
  const target = new URL(url);
  const scope = absoluteUrl(config.origin, normaliseScopePath(config.scopePath));
  const inScope = target.href.startsWith(scope) || target.href === scope.slice(0, -1);
  const homeTab =
    inScope &&
    config.tabbed &&
    config.homeTabPaths
      .map((p) => p.trim())
      .filter(Boolean)
      .some((p) => new URLPattern(scopePattern(config.origin, p)).test(target.href));
  return { inScope, homeTab };
}

export type Severity = 'error' | 'warning';
export interface Problem {
  severity: Severity;
  message: string;
}

/** Problems that would stop the app installing or behaving as configured. */
export function validate(config: SiteConfig): Problem[] {
  const problems: Problem[] = [];
  const err = (message: string) => problems.push({ severity: 'error', message });
  const warn = (message: string) => problems.push({ severity: 'warning', message });

  if (!config.name.trim()) err('The app needs a name.');

  let scope: string | undefined;
  try {
    scope = absoluteUrl(config.origin, normaliseScopePath(config.scopePath));
  } catch (e) {
    err(`In-app path: ${(e as Error).message}`);
  }
  try {
    const start = absoluteUrl(config.origin, config.startPath);
    if (scope && !start.startsWith(scope)) {
      err('The start page must be inside the in-app path, or Chrome will ignore the scope.');
    }
  } catch (e) {
    err(`Start page: ${(e as Error).message}`);
  }

  const largest = Math.max(
    0,
    ...config.icons.flatMap((i) => (i.sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0)),
  );
  if (!config.icons.length) err('Chrome needs at least one icon before it will install the app.');
  else if (largest < 144) warn('Chrome prefers an icon of at least 144×144; the app may not install.');

  if (config.tabbed && config.newTabPath?.trim()) {
    try {
      const newTab = absoluteUrl(config.origin, config.newTabPath);
      if (checkUrl(config, newTab).homeTab) {
        warn('The new tab page is inside the home tab, so Chrome will hide the new tab button.');
      }
    } catch (e) {
      err(`New tab page: ${(e as Error).message}`);
    }
  }
  for (const p of config.homeTabPaths) {
    try {
      new URLPattern(scopePattern(config.origin, p));
    } catch {
      err(`Home tab pattern "${p}" is not a valid URL pattern.`);
    }
  }
  return problems;
}

/** Base64 that survives non-Latin-1 characters in names. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function manifestDataUrl(manifest: WebAppManifest): string {
  return `data:application/json;base64,${toBase64(JSON.stringify(manifest))}`;
}

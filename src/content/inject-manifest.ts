// Registered at document_start on every site the user has appified. Replaces the
// site's <link rel="manifest"> with Appify's data: manifest and keeps it there.

import type { AppifyMessage } from '../lib/messages';
import { getSite, siteKey } from '../lib/storage';
import { buildManifest, manifestDataUrl, type SiteConfig } from '../lib/web-manifest';

const LOG = '[Appify]';

let href: string | undefined;
let config: SiteConfig | undefined;

function manifestHref(site: SiteConfig | undefined): string | undefined {
  if (!site?.enabled) return undefined;
  try {
    return manifestDataUrl(buildManifest(site));
  } catch (e) {
    console.warn(LOG, 'Invalid site config, leaving the page manifest alone:', e);
    return undefined;
  }
}

/** Makes Appify's link the only manifest link. Cheap enough to run on every head mutation. */
function apply(): void {
  const head = document.head;
  if (!head) return;
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="manifest"]'));
  const ours = links.find((l) => l.dataset.appify !== undefined);

  if (!href) {
    ours?.remove();
    return;
  }
  for (const link of links) {
    if (link !== ours) link.remove();
  }
  if (ours && ours.getAttribute('href') === href) return;

  const link = ours ?? document.createElement('link');
  link.rel = 'manifest';
  link.dataset.appify = '';
  link.setAttribute('href', href);
  if (!ours) head.prepend(link);
}

let headObserver: MutationObserver | undefined;

function watchHead(): void {
  const head = document.head;
  if (!head || headObserver) return;
  headObserver = new MutationObserver(apply);
  // Single-page apps (Messenger included) re-render <head> and re-add their manifest.
  headObserver.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['rel', 'href'] });
  apply();
}

let rootObserver: MutationObserver | undefined;

function watchForHead(): void {
  if (document.head) return watchHead();
  if (rootObserver) return;
  const root = document.documentElement ?? document;
  rootObserver = new MutationObserver(() => {
    if (!document.head) return;
    rootObserver?.disconnect();
    watchHead();
  });
  rootObserver.observe(root, { childList: true, subtree: true });
}

function send(message: AppifyMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Service worker restarting; the next page load will report again.
  });
}

let reportingCsp = false;

function reportCspViolations(): void {
  if (reportingCsp) return;
  reportingCsp = true;
  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.effectiveDirective === 'manifest-src' && href && event.blockedURI.startsWith('data')) {
      console.warn(LOG, "The site's Content-Security-Policy blocked Appify's manifest.");
      send({ type: 'csp-blocked' });
    }
  });
}

/** Tells the service worker whether tabbed mode actually took effect in this app window. */
function reportDisplayMode(): void {
  const modes = ['tabbed', 'window-controls-overlay', 'fullscreen', 'standalone', 'minimal-ui'];
  const mode = modes.find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? 'browser';
  if (mode === 'browser' || !config?.enabled) return;
  send({ type: 'display-mode', mode, wantsTabbed: config.tabbed });
}

function update(site: SiteConfig | undefined): void {
  config = site;
  href = manifestHref(site);
  if (href) {
    reportCspViolations();
    watchForHead();
  }
  apply();
}

async function main(): Promise<void> {
  // Edits in the popup or editor, including turning the site on, apply to open pages straight away.
  const key = siteKey(location.origin);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && key in changes) update(changes[key].newValue as SiteConfig | undefined);
  });
  update(await getSite(location.origin));

  if (document.readyState === 'complete') reportDisplayMode();
  else addEventListener('load', reportDisplayMode, { once: true });
}

// The service worker also injects this into tabs that were open before the site
// was added, which can land on a page where the registered copy already runs.
const scope = globalThis as typeof globalThis & { __appify?: boolean };
if (!scope.__appify) {
  scope.__appify = true;
  main().catch((e) => console.warn(LOG, e));
}

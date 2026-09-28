// Site configs live in chrome.storage.local (icons are data: URLs, too big for
// sync), one key per origin so the content script only reads its own.

import type { SiteConfig } from './web-manifest';

const SITE_PREFIX = 'site:';
const FLAGS_KEY = 'appify:flags';
const CSP_BLOCKED_KEY = 'appify:cspBlocked';

export const siteKey = (origin: string) => `${SITE_PREFIX}${origin}`;

export async function getSite(origin: string): Promise<SiteConfig | undefined> {
  const key = siteKey(origin);
  const result = await chrome.storage.local.get(key);
  return result[key] as SiteConfig | undefined;
}

export async function getAllSites(): Promise<SiteConfig[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(SITE_PREFIX))
    .map(([, value]) => value as SiteConfig)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSite(config: SiteConfig): Promise<void> {
  await chrome.storage.local.set({ [siteKey(config.origin)]: { ...config, updatedAt: Date.now() } });
}

export async function deleteSite(origin: string): Promise<void> {
  await chrome.storage.local.remove(siteKey(origin));
  await clearCspBlocked(origin);
}

export function isSiteKey(key: string): boolean {
  return key.startsWith(SITE_PREFIX);
}

/**
 * Whether Chrome's tab strip flags are on. Extensions can't read chrome://flags,
 * so this is learned from an installed app window's `display-mode`.
 */
export type FlagStatus = 'unknown' | 'working' | 'not-working';
export interface FlagState {
  status: FlagStatus;
  checkedAt?: number;
  /** Origin of the app window the status came from. */
  origin?: string;
}

export async function getFlagState(): Promise<FlagState> {
  const result = await chrome.storage.local.get(FLAGS_KEY);
  return (result[FLAGS_KEY] as FlagState | undefined) ?? { status: 'unknown' };
}

export async function setFlagState(state: FlagState): Promise<void> {
  await chrome.storage.local.set({ [FLAGS_KEY]: state });
}

export const FLAGS_STORAGE_KEY = FLAGS_KEY;

/** Origins where the site's CSP was seen blocking Appify's manifest. */
export async function getCspBlocked(): Promise<Record<string, number>> {
  const result = await chrome.storage.local.get(CSP_BLOCKED_KEY);
  return (result[CSP_BLOCKED_KEY] as Record<string, number> | undefined) ?? {};
}

export async function markCspBlocked(origin: string): Promise<void> {
  const blocked = await getCspBlocked();
  if (blocked[origin]) return;
  await chrome.storage.local.set({ [CSP_BLOCKED_KEY]: { ...blocked, [origin]: Date.now() } });
}

export async function clearCspBlocked(origin: string): Promise<void> {
  const { [origin]: _, ...rest } = await getCspBlocked();
  await chrome.storage.local.set({ [CSP_BLOCKED_KEY]: rest });
}

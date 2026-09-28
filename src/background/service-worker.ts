// Keeps Chrome's registered content scripts and CSP rules in step with the
// stored site configs, and turns reports from app windows into badges.

import injectScript from '../content/inject-manifest?script&iife';
import type { AppifyMessage } from '../lib/messages';
import type { SiteConfig } from '../lib/web-manifest';
import { hasSitePermission, originPattern } from '../lib/permissions';
import {
  FLAGS_STORAGE_KEY,
  getAllSites,
  getFlagState,
  getSite,
  isSiteKey,
  markCspBlocked,
  setFlagState,
} from '../lib/storage';

const SCRIPT_ID = 'appify-inject';
const WARN_COLOR = '#d93025';

async function syncContentScripts(): Promise<void> {
  const sites = (await getAllSites()).filter((s) => s.enabled);
  const permitted = await Promise.all(sites.map((s) => hasSitePermission(s.origin)));
  const matches = [...new Set(sites.filter((_, i) => permitted[i]).map((s) => originPattern(s.origin)))];

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, js: [injectScript], matches, runAt: 'document_start', persistAcrossSessions: true },
  ]);
}

/** One rule per opted-in site, removing its CSP header so the data: manifest can load. */
async function syncCspRules(): Promise<void> {
  const sites = (await getAllSites()).filter((s) => s.enabled && s.cspBypass);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: sites.map((site, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
        responseHeaders: [
          {
            header: 'content-security-policy',
            operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        urlFilter: `|${site.origin}/`,
        resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
      },
    })),
  });
}

async function syncBadge(): Promise<void> {
  const { status } = await getFlagState();
  const broken = status === 'not-working';
  await chrome.action.setBadgeBackgroundColor({ color: WARN_COLOR });
  await chrome.action.setBadgeText({ text: broken ? '!' : '' });
  await chrome.action.setTitle({
    title: broken ? 'Appify: tabbed mode is off. Open to enable the Chrome flags.' : 'Appify',
  });
}

// Storage events arrive in bursts; run syncs one at a time so registrations don't collide.
let queue: Promise<void> = Promise.resolve();
function sync(): Promise<void> {
  queue = queue
    .then(() => Promise.all([syncContentScripts(), syncCspRules(), syncBadge()]))
    .then(
      () => undefined,
      (e) => console.error('Appify sync failed', e),
    );
  return queue;
}

/** Runs the injector in tabs that were already open, so a newly added site works without a reload. */
async function injectIntoOpenTabs(origin: string): Promise<void> {
  const site = await getSite(origin);
  if (!site?.enabled || !(await hasSitePermission(origin))) return;
  const tabs = await chrome.tabs.query({ url: originPattern(origin) });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && tab.url && new URL(tab.url).origin === origin)
      .map((tab) =>
        chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: [injectScript] }).catch(() => {
          // Tab closed or navigated away meanwhile.
        }),
      ),
  );
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await sync();
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
  }
});
chrome.runtime.onStartup.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
// The popup saves a site before asking for access, because on macOS the access
// prompt can close the popup. So the rest of the setup happens here.
chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  await sync();
  const sites = await getAllSites();
  for (const site of sites) {
    if (origins.includes(originPattern(site.origin))) await injectIntoOpenTabs(site.origin);
  }
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (!Object.keys(changes).some((key) => isSiteKey(key) || key === FLAGS_STORAGE_KEY)) return;
  await sync();
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    const turnedOn = isSiteKey(key) && (newValue as SiteConfig | undefined)?.enabled && !(oldValue as SiteConfig | undefined)?.enabled;
    if (turnedOn) await injectIntoOpenTabs((newValue as SiteConfig).origin);
  }
});

chrome.runtime.onMessage.addListener((message: AppifyMessage, sender) => {
  const tabId = sender.tab?.id;
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined);
  if (!origin) return;

  if (message.type === 'csp-blocked') {
    (async () => {
      const site = await getSite(origin);
      await markCspBlocked(origin);
      if (tabId === undefined) return;
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setTitle({
        tabId,
        title: site?.cspBypass
          ? "Appify: this site's page blocks the manifest in a way Appify can't remove."
          : "Appify: this site's security policy blocked the app manifest. Open to fix.",
      });
    })();
  }

  if (message.type === 'display-mode' && message.wantsTabbed) {
    const status = message.mode === 'tabbed' ? 'working' : 'not-working';
    // Only write on change: every app window load reports, and writes trigger a sync.
    getFlagState().then((current) => {
      if (current.status !== status) setFlagState({ status, checkedAt: Date.now(), origin });
    });
  }
});

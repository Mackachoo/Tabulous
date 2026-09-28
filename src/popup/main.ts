import { fetchIconsInPage, inspectPage, type PageInfo } from '../lib/detect';
import { blobToIcons, iconsFromCandidates, largestIcon, rankCandidates } from '../lib/icons';
import { hasSitePermission, removeSitePermission, requestSitePermission } from '../lib/permissions';
import {
  clearCspBlocked,
  deleteSite,
  getCspBlocked,
  getFlagState,
  getSite,
  markCspBlocked,
  saveSite,
  type FlagState,
} from '../lib/storage';
import { checkUrl, defaultSiteConfig, validate, type ManifestIcon, type SiteConfig } from '../lib/web-manifest';
import { presetFor } from '../presets';
import { $, h, listRow, mount, notice, toggle, toggleRow } from '../ui/dom';
import { icon } from '../ui/icons';

interface State {
  tab: chrome.tabs.Tab;
  origin: string;
  config?: SiteConfig;
  /** Icon sets made from the page's icons, best first, ready before "Add in Tabulous" is clicked. */
  iconOptions: ManifestIcon[][];
  permitted: boolean;
  page?: PageInfo;
  flags: FlagState;
  cspBlocked: boolean;
  busy?: string;
  error?: string;
  scopeInput: string;
}

let state: State;
const root = $('#app');

const EDITOR_URL = chrome.runtime.getURL('src/options/index.html');
const ONBOARDING_URL = chrome.runtime.getURL('src/onboarding/index.html');

async function inspect(tabId: number): Promise<PageInfo | undefined> {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: inspectPage });
    return result?.result as PageInfo | undefined;
  } catch {
    return undefined; // Pages Chrome won't let extensions script, e.g. the Web Store.
  }
}

/**
 * Downloads the page's best icons from inside the page (activeTab is enough, no
 * host permission yet), then renders each one that decodes to a set of PNGs.
 */
async function prepareIcons(tabId: number, page: PageInfo): Promise<ManifestIcon[][]> {
  const ranked = rankCandidates(page.icons).slice(0, 4);
  const options: ManifestIcon[][] = [];
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fetchIconsInPage,
      args: [ranked.map((c) => c.url)],
    });
    for (const { dataUrl } of result?.result ?? []) {
      try {
        const icons = await blobToIcons(await (await fetch(dataUrl)).blob());
        // Sites often list the same image more than once.
        if (!options.some((o) => o[0].src === icons[0].src)) options.push(icons);
      } catch {
        // Not a decodable image.
      }
    }
  } catch {
    // Page can't be scripted.
  }
  return options;
}

/** "(3) Messenger" → "Messenger", "Inbox | Site" → "Inbox". */
function cleanTitle(title: string | undefined): string | undefined {
  const cleaned = title?.replace(/^\(\d+\+?\)\s*/, '').split(/\s[|–—-]\s/)[0].trim();
  return cleaned || undefined;
}

function newConfig(): SiteConfig {
  const page = state.page;
  const detected: Partial<SiteConfig> = { icons: state.iconOptions[0] ?? [], needsSetup: true };
  const name = cleanTitle(page?.title);
  if (name) detected.name = name;
  if (page?.themeColor) detected.themeColor = page.themeColor;
  return defaultSiteConfig(state.origin, { ...detected, ...presetFor(state.origin) });
}

async function update(changes: Partial<SiteConfig>): Promise<void> {
  if (!state.config) return;
  clearTimeout(pendingSave);
  state.config = { ...state.config, ...changes };
  await saveSite(state.config);
  render();
}

// Typing in the setup form saves shortly after each change, without
// re-rendering (which would move focus out of the field).
let pendingSave: ReturnType<typeof setTimeout> | undefined;
const setupProblems = h('div', { class: 'stack' });

function edit(changes: Partial<SiteConfig>): void {
  if (!state.config) return;
  state.config = { ...state.config, ...changes };
  clearTimeout(pendingSave);
  const config = state.config;
  pendingSave = setTimeout(() => saveSite(config), 250);
  showSetupProblems(config);
}

function flushSave(): void {
  if (pendingSave === undefined || !state.config) return;
  clearTimeout(pendingSave);
  pendingSave = undefined;
  saveSite(state.config);
}
addEventListener('pagehide', flushSave);

/**
 * On macOS Chrome's site access prompt can close the popup, ending any script
 * still waiting on it. So the config is saved in the same instant access is
 * requested, and the service worker applies it once access is granted.
 */
function addSite(): void {
  const config = newConfig();
  const saved = saveSite(config);
  const granted = requestSitePermission(state.origin);
  state.busy = 'Waiting for access to this site…';
  state.error = undefined;
  render();
  finishAddSite(config, saved, granted);
}

async function finishAddSite(config: SiteConfig, saved: Promise<void>, granted: Promise<boolean>): Promise<void> {
  await saved;
  if (!(await granted)) {
    await deleteSite(state.origin);
    state.busy = undefined;
    state.error = 'Tabulous needs access to this site to replace its manifest.';
    return render();
  }
  state.config = config;
  state.permitted = true;

  if (!config.icons.length && state.page) {
    state.busy = 'Preparing icons…';
    render();
    const { icons } = await iconsFromCandidates(state.page.icons);
    if (icons.length) await update({ icons });
  }
  if (state.page?.cspBlocksManifest) {
    await markCspBlocked(state.origin);
    state.cspBlocked = true;
  }
  state.busy = undefined;
  render();
  // The service worker adds the manifest to the open page; show it once it has.
  setTimeout(refreshPage, 600);
}

async function refreshPage(): Promise<void> {
  if (state.tab.id === undefined) return;
  state.page = await inspect(state.tab.id);
  // The setup form doesn't show page status, and re-rendering it would interrupt typing.
  if (!state.config?.needsSetup) render();
}

async function remove(): Promise<void> {
  await deleteSite(state.origin);
  await removeSitePermission(state.origin);
  state.config = undefined;
  state.permitted = false;
  state.cspBlocked = false;
  render();
}

async function reloadTab(): Promise<void> {
  if (state.tab.id !== undefined) await chrome.tabs.reload(state.tab.id);
  window.close();
}

function openEditor(): void {
  flushSave();
  chrome.tabs.create({ url: state?.config ? `${EDITOR_URL}#${encodeURIComponent(state.origin)}` : EDITOR_URL });
}

// ---- views -------------------------------------------------------------------

function header(withToggle = true): HTMLElement {
  const config = state.config;
  const siteIcon = config ? largestIcon(config.icons) : undefined;
  const favicon = state.tab.favIconUrl;
  return h(
    'header',
    { class: 'popup-header' },
    siteIcon || favicon
      ? h('img', { class: 'site-icon', src: siteIcon?.src ?? favicon, alt: '' })
      : h('span', { class: 'site-icon' }, icon('apps')),
    h(
      'div',
      { class: 'popup-title' },
      h('h2', null, config?.name ?? new URL(state.origin).hostname),
      h('div', { class: 'secondary' }, new URL(state.origin).host),
    ),
    withToggle && config && toggle(config.enabled, (enabled) => update({ enabled }), 'Tabulous on this site'),
  );
}

function footer(): HTMLElement {
  return h(
    'footer',
    { class: 'popup-footer' },
    h('button', { class: 'btn text', onclick: openEditor }, icon('edit', 18), state?.config ? 'Edit settings' : 'All sites'),
    h('span', { class: 'spacer' }),
    state?.config && h('button', { class: 'btn text danger', onclick: remove }, icon('delete', 18), 'Remove'),
  );
}

function renderNotWeb(): void {
  mount(
    root,
    h(
      'header',
      { class: 'popup-header' },
      h('img', { class: 'site-icon', src: chrome.runtime.getURL('icons/icon-48.png'), alt: '' }),
      h('div', { class: 'popup-title' }, h('h2', { class: 'wordmark' }, 'Tabulous'), h('div', { class: 'secondary' }, 'Open a website to turn it into an app.')),
    ),
    h(
      'footer',
      { class: 'popup-footer' },
      h('button', { class: 'btn text', onclick: openEditor }, icon('apps', 18), 'All sites'),
    ),
  );
}

function renderNew(): void {
  const preset = presetFor(state.origin);
  mount(
    root,
    header(),
    h(
      'div',
      { class: 'popup-body' },
      h(
        'p',
        { class: 'secondary' },
        state.page?.siteManifestUrl
          ? 'This site has its own web app manifest. Tabulous replaces it with one you control, so you choose how the app behaves.'
          : 'This site has no web app manifest. Tabulous adds one so it installs as an app, with tabs if you like.',
      ),
      preset && notice('info', 'Tabulous has built-in settings for this site.'),
      state.error && notice('error', state.error),
      state.busy
        ? h('div', { class: 'busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), state.busy)
        : h('button', { class: 'btn action wide', onclick: addSite }, icon('add', 18), 'Add in Tabulous'),
    ),
    footer(),
  );
}

function pageStatus(config: SiteConfig): (HTMLElement | false)[] {
  const page = state.page;
  if (!state.permitted) {
    return [
      notice(
        'error',
        'Tabulous doesn’t have access to this site, so it can’t add the manifest.',
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              state.permitted = await requestSitePermission(state.origin);
              render();
            },
          },
          'Allow access',
        ),
      ),
    ];
  }
  if (!config.enabled) return [notice('info', 'Tabulous is turned off for this site.')];
  if (state.busy) return [h('div', { class: 'busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), state.busy)];
  const blocked = state.cspBlocked && !config.cspBypass;
  const installed = page !== undefined && page.displayMode !== 'browser';
  return [
    page?.tabulousManifestPresent
      ? !blocked && notice('ok', installed ? `Running as an installed app (${page.displayMode}).` : 'The Tabulous manifest is active on this page.')
      : notice('info', 'Reload the page to apply the Tabulous manifest.', h('button', { class: 'btn', onclick: reloadTab }, icon('refresh', 18), 'Reload')),
  ];
}

function cspSection(config: SiteConfig): HTMLElement | false {
  if (config.cspBypass) {
    return notice(
      'info',
      'This site’s Content-Security-Policy header is removed so the manifest can load.',
      h('button', { class: 'link', onclick: () => update({ cspBypass: false }) }, 'Restore it'),
    );
  }
  if (!state.cspBlocked) return false;
  return notice(
    'warn',
    h('strong', null, 'This site’s security policy blocks the Tabulous manifest.'),
    'Tabulous can remove the Content-Security-Policy header for this site only. That makes the site less protected if it has a script injection bug.',
    h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          await clearCspBlocked(state.origin);
          await update({ cspBypass: true });
          await reloadTab();
        },
      },
      'Remove policy and reload',
    ),
  );
}

function flagsRow(config: SiteConfig): HTMLElement | false {
  const flags = state.flags.status;
  if (!config.tabbed || flags === 'working') return false;
  return listRow(
    [icon(flags === 'not-working' ? 'warning' : 'flag', 18), flags === 'not-working' ? 'App opened without tabs' : 'Chrome flags needed'],
    flags === 'not-working'
      ? 'Turn on the tab strip flags and relaunch Chrome. If they’re on, reinstall the app.'
      : 'Tabbed windows need two Chrome flags turned on.',
    h('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: ONBOARDING_URL }) }, 'Set up'),
  );
}

function describeUrl(config: SiteConfig, url: string): { text: string; inApp?: boolean } {
  try {
    const check = checkUrl(config, url);
    if (!check.inScope) return { text: 'Outside the app: Chrome shows the URL bar', inApp: false };
    return { text: check.homeTab ? 'In the app, home tab' : 'In the app', inApp: true };
  } catch {
    return { text: 'Enter a full URL' };
  }
}

function scopeTester(config: SiteConfig): HTMLElement {
  const output = h('div', { class: 'scope-result' });
  const show = () => {
    const { text, inApp } = describeUrl(config, state.scopeInput);
    output.className = `scope-result${inApp === undefined ? '' : inApp ? ' in' : ' out'}`;
    mount(output, inApp === undefined ? false : icon(inApp ? 'checkCircle' : 'warning', 16), text);
  };
  show();
  return h(
    'div',
    { class: 'card-body stack' },
    h('div', { class: 'list-row-title' }, 'Is this URL in the app?'),
    h('input', {
      type: 'url',
      value: state.scopeInput,
      'aria-label': 'URL to test',
      oninput: (e: Event) => {
        state.scopeInput = (e.target as HTMLInputElement).value;
        show();
      },
    }),
    output,
  );
}

// ---- setup form, shown after "Add in Tabulous" ---------------------------------

function setupField(label: string, value: string, onInput: (value: string) => void, hint?: string, placeholder?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('input', { type: 'text', value, placeholder, oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) }),
    hint && h('span', { class: 'hint' }, hint),
  );
}

function showSetupProblems(config: SiteConfig): void {
  const problems = validate(config);
  mount(setupProblems, ...problems.map((p) => notice(p.severity === 'error' ? 'error' : 'warn', p.message)));
}

/** Icon, name and the other icons found on the page. */
function identity(config: SiteConfig): HTMLElement {
  const current = largestIcon(config.icons);
  const options = state.iconOptions.length > 1 ? state.iconOptions : [];
  return h(
    'div',
    { class: 'identity' },
    current ? h('img', { class: 'site-icon large', src: current.src, alt: 'App icon' }) : h('span', { class: 'site-icon large' }, icon('apps', 28)),
    h(
      'div',
      { class: 'identity-fields' },
      setupField('Name', config.name, (name) => edit({ name })),
      options.length > 0 &&
        h(
          'div',
          { class: 'icon-choices', role: 'group', 'aria-label': 'Icons found on the page' },
          ...options.map((option, i) =>
            h(
              'button',
              {
                class: 'icon-choice',
                'aria-pressed': String(option[0].src === config.icons[0]?.src),
                'aria-label': `Icon ${i + 1}`,
                onclick: () => update({ icons: option }),
              },
              h('img', { src: option[0].src, alt: '' }),
            ),
          ),
        ),
      // A file picker would close the popup on macOS, so uploads happen in the editor.
      h('button', { class: 'link hint', onclick: openEditor }, 'Upload a different icon…'),
    ),
  );
}

function renderSetup(config: SiteConfig): void {
  showSetupProblems(config);
  mount(
    root,
    header(false),
    h(
      'div',
      { class: 'popup-body' },
      h('p', { class: 'secondary' }, 'Check these before you install.'),
      !state.permitted && pageStatus(config),
      h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-body' }, identity(config)),
        h(
          'div',
          { class: 'card-body stack' },
          h(
            'div',
            { class: 'field-pair' },
            setupField('Start page', config.startPath, (startPath) => edit({ startPath }), undefined, '/'),
            setupField('In-app path', config.scopePath, (scopePath) => edit({ scopePath }), undefined, '/'),
          ),
          h('span', { class: 'hint' }, 'The app opens on the start page. Pages under the in-app path open without the URL bar.'),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        toggleRow('Tabbed app window', 'Open pages of the app as tabs in one window', config.tabbed, (tabbed) => update({ tabbed })),
        config.tabbed &&
          h(
            'div',
            { class: 'card-body stack' },
            h(
              'label',
              { class: 'field' },
              h('span', null, 'Home tab pages'),
              h('textarea', {
                rows: 2,
                value: config.homeTabPaths.join('\n'),
                placeholder: '/\n/inbox/*',
                oninput: (e: Event) =>
                  edit({ homeTabPaths: (e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean) }),
              }),
              h('span', { class: 'hint' }, 'URL patterns, one per line, for the pinned home tab. Empty for none.'),
            ),
            setupField('New tab page', config.newTabPath ?? '', (newTabPath) => edit({ newTabPath: newTabPath || undefined }), 'What the + button opens.', '/'),
          ),
        flagsRow(config),
      ),
      setupProblems,
    ),
    h(
      'footer',
      { class: 'popup-footer sticky' },
      h('button', { class: 'btn text', onclick: openEditor }, icon('edit', 18), 'More settings'),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn action',
          onclick: () => {
            flushSave();
            update({ needsSetup: undefined });
          },
        },
        'Done',
      ),
    ),
  );
}

function renderConfigured(config: SiteConfig): void {
  const problems = validate(config);
  mount(
    root,
    header(),
    h(
      'div',
      { class: 'popup-body' },
      ...pageStatus(config),
      ...problems.map((p) => notice(p.severity === 'error' ? 'error' : 'warn', p.message)),
      cspSection(config),
      h(
        'section',
        { class: 'card' },
        toggleRow('Tabbed app window', 'Open pages of the app as tabs in one window', config.tabbed, (tabbed) => update({ tabbed })),
        flagsRow(config),
        scopeTester(config),
        listRow(
          'Install',
          'Uninstall any app you already have for this site, then use Chrome menu ⋮ › Cast, save and share › Install page as app.',
        ),
      ),
    ),
    footer(),
  );
}

function render(): void {
  if (!state.config) renderNew();
  else if (state.config.needsSetup) renderSetup(state.config);
  else renderConfigured(state.config);
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) return renderNotWeb();
  const origin = new URL(tab.url).origin;

  const [config, permitted, flags, cspBlocked, page] = await Promise.all([
    getSite(origin),
    hasSitePermission(origin),
    getFlagState(),
    getCspBlocked(),
    tab.id !== undefined ? inspect(tab.id) : undefined,
  ]);
  state = {
    tab,
    origin,
    config,
    permitted,
    page,
    flags,
    cspBlocked: Boolean(cspBlocked[origin]) || Boolean(config && page?.cspBlocksManifest),
    scopeInput: tab.url,
    iconOptions: [],
  };
  render();

  if ((!config || config.needsSetup) && page && tab.id !== undefined) {
    state.iconOptions = await prepareIcons(tab.id, page);
    // Re-render for the icon choices, unless it would interrupt typing.
    if (!state.config || !document.activeElement?.matches('input, textarea')) render();
  }
}

init();

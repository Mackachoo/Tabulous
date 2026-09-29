// End-to-end check of the built extension in Chrome for Testing.
// Run with `npm run e2e` (needs `npx playwright install chromium` once).
//
// Covers everything except installing the app: Chrome for Testing doesn't
// implement the DevTools PWA install commands, so tabbed windows are a manual
// check (see README).

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tabulous-e2e-'));
const EXT = path.join(WORK, 'ext');
const SHOTS = path.join(ROOT, 'e2e', 'screenshots');
const ICON = fs.readFileSync(path.join(ROOT, 'e2e/fixtures/icon-192.png'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Test copy of the extension with localhost access granted at install, since
// the permission prompt can't be clicked from here.
fs.cpSync(path.join(ROOT, 'dist'), EXT, { recursive: true });
const extManifest = JSON.parse(fs.readFileSync(`${EXT}/manifest.json`, 'utf8'));
extManifest.host_permissions = ['http://localhost/*'];
fs.writeFileSync(`${EXT}/manifest.json`, JSON.stringify(extManifest));
fs.mkdirSync(SHOTS, { recursive: true });

// The page re-adds its own manifest after load, like a single-page app would.
const html = `<!doctype html><html><head><title>(2) Test App | Example</title>
<link rel="manifest" href="/site.webmanifest"><link rel="icon" href="/icon.png" sizes="192x192">
<meta name="theme-color" content="#123456"></head><body><h1>Test app</h1>
<script>setTimeout(() => { const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/site.webmanifest?readded'; document.head.append(l); }, 300);</script>
</body></html>`;
const serve = (port, headers = {}) =>
  http
    .createServer((req, res) => {
      if (req.url.startsWith('/site.webmanifest')) {
        res.writeHead(200, { 'content-type': 'application/manifest+json', ...headers });
        return res.end(
          JSON.stringify({
            name: 'Site Own',
            start_url: '/t/1',
            display: 'standalone',
            // Features Tabulous should carry over, with URLs relative to the manifest.
            shortcuts: [{ name: 'Compose', url: 'compose' }],
            protocol_handlers: [{ protocol: 'web+tabulous', url: '/handle?u=%s' }],
            prefer_related_applications: true,
          }),
        );
      }
      if (req.url === '/icon.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(ICON);
      }
      res.writeHead(200, { 'content-type': 'text/html', ...headers });
      res.end(html);
    })
    .listen(port);
const servers = [
  serve(8123),
  serve(8124, { 'content-security-policy': "manifest-src 'self'" }),
  serve(8125),
  serve(8126),
  // Only an Apple touch icon: artwork on a white rounded square with transparent corners, like Messenger's.
  http
    .createServer((req, res) => {
      if (req.url === '/touch.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" rx="40" fill="#fff"/><circle cx="90" cy="90" r="76" fill="#0866ff"/></svg>');
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Bubble</title><link rel="apple-touch-icon" href="/touch.svg"><body>bubble');
    })
    .listen(8127),
];

// Branded Chrome ignores --load-extension, so the extension is loaded over a
// CDP pipe instead. That works for Chrome for Testing too.
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME = process.env.CHROME_PATH ?? (fs.existsSync(MAC_CHROME) ? MAC_CHROME : chromium.executablePath());

let ctx;
let browser;
try {
  ctx = await chromium.launchPersistentContext(path.join(WORK, 'profile'), {
    executablePath: CHROME,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-unsafe-extension-debugging',
      '--enable-features=DesktopPWAsTabStrip,DesktopPWAsTabStripCustomizations',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  browser = ctx.browser();
  const { id: extId } = await (await browser.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
  console.log(`Chrome ${browser.version()}\n`);
  await sleep(1000);
  const onboardingOpened = ctx.pages().some((p) => p.url().includes('src/onboarding/index.html'));
  // Playwright doesn't attach to the service worker of an extension loaded
  // after launch, so extension APIs are driven from one of its pages.
  const sw = await ctx.newPage();
  await sw.goto(`chrome-extension://${extId}/src/onboarding/index.html`);
  const storageGet = (key) => sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  const saveSite = (config) => sw.evaluate(async (c) => chrome.storage.local.set({ [`site:${c.origin}`]: c }), config);

  check('onboarding page opens on install', onboardingOpened);

  const icon = `data:image/png;base64,${ICON.toString('base64')}`;
  const site = (origin, extra = {}) => ({
    origin,
    enabled: true,
    name: 'Test App',
    startPath: '/',
    scopePath: '/',
    themeColor: '#123456',
    icons: [{ src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' }],
    tabbed: true,
    homeTabPaths: ['/'],
    newTabPath: '/t/new',
    launchMode: 'auto',
    shortcuts: [],
    cspBypass: false,
    overrides: {},
    updatedAt: Date.now(),
    ...extra,
  });
  await saveSite(site('http://localhost:8123'));
  await saveSite(site('http://localhost:8124'));

  let registered = [];
  for (let i = 0; i < 20 && !registered.length; i++) {
    await sleep(200);
    registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  }
  check('content script registered for the site', registered[0]?.matches?.includes('http://localhost/*'), JSON.stringify(registered[0]?.matches));

  // --- the site's manifest is replaced ----------------------------------------
  const page = await ctx.newPage();
  await page.goto('http://localhost:8123/t/1');
  await sleep(800); // past the page's own re-add at 300ms
  const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~=manifest]')].map((l) => l.getAttribute('href').slice(0, 30)));
  check('only Tabulous’s manifest link remains after the site re-adds its own', links.length === 1 && links[0].startsWith('data:application/json'), JSON.stringify(links));

  const cdp = await ctx.newCDPSession(page);
  const app = await cdp.send('Page.getAppManifest');
  const parsed = app.data ? JSON.parse(app.data) : {};
  check('Chrome loads the data: manifest', app.url.startsWith('data:application/json'));
  check('the manifest has no parse errors', app.errors.length === 0, JSON.stringify(app.errors));
  check('scope is the whole origin, not the install page’s folder', parsed.scope === 'http://localhost:8123/', parsed.scope);
  check('Chrome parses display_override tabbed', app.manifest?.displayOverrides?.[0] === 'kTabbed', String(app.manifest?.displayOverrides));
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome considers the site installable', installabilityErrors.length === 0, JSON.stringify(installabilityErrors));

  // --- CSP blocking and the opt-in bypass --------------------------------------
  const strictPage = await ctx.newPage();
  await strictPage.goto('http://localhost:8124/');
  await sleep(500);
  const strictCdp = await ctx.newCDPSession(strictPage);
  const blocked = await strictCdp.send('Page.getAppManifest');
  await sleep(500);
  check('the site’s CSP blocks the data: manifest', !blocked.data);
  check('the CSP violation is reported to the service worker', Boolean((await storageGet('tabulous:cspBlocked'))?.['http://localhost:8124']));

  await saveSite(site('http://localhost:8124', { cspBypass: true }));
  await sleep(800);
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  check('a CSP removal rule is added for that origin only', rules.length === 1 && rules[0].condition.urlFilter === '|http://localhost:8124/', JSON.stringify(rules.map((r) => r.condition)));
  await strictPage.reload();
  await sleep(500);
  const unblocked = await strictCdp.send('Page.getAppManifest');
  check('with the bypass on, the manifest loads', Boolean(unblocked.data) && unblocked.errors.length === 0);

  // --- live edits ---------------------------------------------------------------
  await saveSite(site('http://localhost:8123', { name: 'Renamed' }));
  await sleep(500);
  const renamed = JSON.parse((await cdp.send('Page.getAppManifest')).data ?? '{}');
  check('editing the config updates the open page', renamed.name === 'Renamed', renamed.name);

  // --- window style, link handlers, shortcuts and the install dialog ---------------
  await saveSite(
    site('http://localhost:8123', {
      name: 'Renamed',
      tabbed: false,
      display: 'minimal-ui',
      titleBarOverlay: true,
      dragSelector: 'h1',
      description: 'A test app',
      protocolHandlers: [{ protocol: 'mailto', path: '/compose?to=%s' }],
      shortcuts: [{ name: 'New', path: '/new', description: 'Start something', icon }],
      screenshots: [{ src: icon, sizes: '192x192', type: 'image/png', form_factor: 'wide', label: 'Home' }],
    }),
  );
  await sleep(500);
  const featured = await cdp.send('Page.getAppManifest');
  const featuredRaw = JSON.parse(featured.data ?? '{}');
  check('the richer manifest has no parse errors', featured.errors.length === 0, JSON.stringify(featured.errors));
  check(
    'Chrome parses the title bar overlay and window style',
    featured.manifest?.displayOverrides?.join() === 'kWindowControlsOverlay,kMinimalUi',
    String(featured.manifest?.displayOverrides),
  );
  check(
    'Chrome parses the mailto: link handler',
    featured.manifest?.protocolHandlers?.[0]?.protocol === 'mailto' && featured.manifest.protocolHandlers[0].url === 'http://localhost:8123/compose?to=%s',
    JSON.stringify(featured.manifest?.protocolHandlers),
  );
  check(
    'the manifest has the description, screenshot and shortcut icon',
    featuredRaw.description === 'A test app' &&
      featuredRaw.screenshots?.[0]?.form_factor === 'wide' &&
      featuredRaw.shortcuts?.[0]?.description === 'Start something' &&
      featuredRaw.shortcuts[0].icons?.[0]?.sizes === '96x96',
    JSON.stringify({ description: featuredRaw.description, shortcut: { ...featuredRaw.shortcuts?.[0], icons: featuredRaw.shortcuts?.[0]?.icons?.length } }),
  );
  // insertCSS sheets aren't in document.styleSheets, DevTools can't emulate
  // display-mode, and it won't return an injected sheet's text. So count the
  // page's injected sheets; only Tabulous injects CSS here. The rules
  // themselves are covered by the pageCss unit tests.
  const cssCdp = await ctx.newCDPSession(page);
  const sheets = new Map();
  cssCdp.on('CSS.styleSheetAdded', ({ header }) => sheets.set(header.styleSheetId, header));
  cssCdp.on('CSS.styleSheetRemoved', ({ styleSheetId }) => sheets.delete(styleSheetId));
  await cssCdp.send('DOM.enable');
  await cssCdp.send('CSS.enable');
  const injectedSheets = async () => {
    await sleep(300);
    return [...sheets.values()].filter((s) => s.origin === 'injected').length;
  };
  const inserted = await injectedSheets();
  check('the drag area CSS is added to the page', inserted === 1, `${inserted} sheet(s)`);
  await saveSite(site('http://localhost:8123', { name: 'Renamed', tabbed: false, titleBarOverlay: false, dragSelector: 'h1' }));
  await sleep(500);
  const afterOff = await injectedSheets();
  check('turning the title bar overlay off removes the CSS', afterOff === 0, `${afterOff} sheet(s)`);
  await cssCdp.detach();

  // --- pages ------------------------------------------------------------------------
  const editor = await ctx.newPage();
  await editor.setViewportSize({ width: 1280, height: 1000 });
  await editor.goto(`chrome-extension://${extId}/src/options/index.html#${encodeURIComponent('http://localhost:8123')}`);
  await sleep(500);
  check('the editor shows the site ready to install', (await editor.locator('main').innerText()).includes('Ready to install'));
  await editor.screenshot({ path: `${SHOTS}/editor.png`, fullPage: true });
  await editor.emulateMedia({ colorScheme: 'dark' });
  await editor.screenshot({ path: `${SHOTS}/editor-dark.png`, fullPage: true });
  await editor.emulateMedia({ colorScheme: 'light' });
  // The title bar overlay and shortcut rows, as edited in the page.
  await editor.getByRole('switch', { name: 'Put the page in the title bar' }).click();
  await editor.getByLabel('Drag area').fill('h1');
  await editor.getByRole('button', { name: 'Add shortcut' }).click();
  await editor.getByLabel('Shortcut 1 name').fill('Compose');
  await editor.getByLabel('Shortcut 1 page').fill('/compose');
  await editor.getByRole('button', { name: 'Add shortcut' }).click();
  await editor.getByLabel('Shortcut 2 name').fill('Inbox');
  await editor.getByLabel('Shortcut 2 page').fill('/inbox');
  await editor.getByLabel('Shortcut 1 description').fill('Write something');
  const preview = JSON.parse((await editor.locator('pre.json').innerText()).replace(/"data:[^"]*…"/g, '""'));
  check(
    'the editor’s title bar and shortcut controls update the manifest',
    preview.display_override?.[0] === 'window-controls-overlay' &&
      preview.shortcuts?.map((s) => s.name).join() === 'Compose,Inbox' &&
      preview.shortcuts[0].description === 'Write something',
    JSON.stringify({ display_override: preview.display_override, shortcuts: preview.shortcuts }),
  );
  // Typing scrolled the page, and full-page shots of a scrolled page repeat the sticky header.
  await editor.evaluate(() => (document.activeElement?.blur(), scrollTo(0, 0)));
  await editor.screenshot({ path: `${SHOTS}/editor-window-shortcuts.png`, fullPage: true });
  await editor.setViewportSize({ width: 700, height: 1000 });
  await editor.locator('section.settings-section', { has: editor.getByRole('heading', { name: 'Behaviour' }) }).screenshot({ path: `${SHOTS}/editor-narrow-shortcuts.png` });
  await editor.setViewportSize({ width: 1280, height: 1000 });

  // Saving opens the site, where Chrome reads the new manifest; saving again reuses that tab.
  const siteTabs = () => ctx.pages().filter((p) => p.url() === 'http://localhost:8123/').length;
  const savedTab = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => undefined);
  await editor.getByRole('button', { name: 'Save' }).click();
  const openedSite = await savedTab;
  await openedSite?.waitForLoadState();
  const tabsAfterFirst = siteTabs();
  await editor.getByLabel('Shortcut 2 page').fill('/inbox/');
  await editor.getByRole('button', { name: 'Save' }).click();
  await sleep(800);
  check(
    'Save opens the app’s start page, and saving again reuses that tab',
    openedSite?.url() === 'http://localhost:8123/' && tabsAfterFirst === 1 && siteTabs() === 1 && (await editor.locator('main').innerText()).includes('open in a tab'),
    `${openedSite?.url()}, ${tabsAfterFirst} then ${siteTabs()} tab(s)`,
  );

  const onboarding = await ctx.newPage();
  await onboarding.setViewportSize({ width: 900, height: 900 });
  await onboarding.goto(`chrome-extension://${extId}/src/onboarding/index.html`);
  await sleep(300);
  await onboarding.screenshot({ path: `${SHOTS}/onboarding.png`, fullPage: true });
  const flagTab = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => undefined);
  await onboarding.getByRole('button', { name: 'Open flag' }).first().click();
  const opened = await flagTab;
  await sleep(500);
  check('"Open flag" opens the flag in chrome://flags', opened?.url() === 'chrome://flags/#enable-desktop-pwas-tab-strip', opened?.url());

  // The popup reads the active tab, so point it at a site tab.
  const popup = async (url, file) => {
    const target = await ctx.newPage();
    await target.goto(url);
    await sleep(400);
    const [tab] = await sw.evaluate((u) => chrome.tabs.query({ url: u }), url);
    const view = await ctx.newPage();
    await view.setViewportSize({ width: 360, height: 700 });
    await view.addInitScript((t) => {
      chrome.tabs.query = async () => [t];
    }, tab);
    const errors = [];
    view.on('pageerror', (e) => errors.push(e.message));
    await view.goto(`chrome-extension://${extId}/src/popup/index.html`);
    await sleep(1200);
    await view.screenshot({ path: `${SHOTS}/${file}`, fullPage: true });
    await view.emulateMedia({ colorScheme: 'dark' });
    await view.screenshot({ path: `${SHOTS}/${file.replace('.png', '-dark.png')}`, fullPage: true });
    await view.emulateMedia({ colorScheme: 'light' });
    return { view, errors, target };
  };
  const configured = await popup('http://localhost:8123/t/1', 'popup-configured.png');
  check('the popup shows the manifest is active', (await configured.view.locator('main').innerText()).includes('manifest is active'), configured.errors.join('; '));
  // captureVisibleTab needs a real toolbar click (activeTab), so it's stubbed
  // with a capture wider than Chrome's install dialog accepts.
  await configured.view.evaluate(() => {
    chrome.tabs.captureVisibleTab = async () => {
      const canvas = new OffscreenCanvas(3000, 900);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 3000, 900);
      const blob = await canvas.convertToBlob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    };
  });
  await configured.view.getByRole('button', { name: /^(re)?capture$/i }).click();
  await sleep(800);
  const [shot] = (await storageGet('site:http://localhost:8123'))?.screenshots ?? [];
  const [shotWidth, shotHeight] = (shot?.sizes ?? '0x0').split('x').map(Number);
  check(
    'Capture saves a wide JPEG screenshot within Chrome’s size limits',
    shot?.type === 'image/jpeg' && shot.form_factor === 'wide' && shotWidth === 1280 && shotWidth / shotHeight <= 2.3 && shot.src.startsWith('data:image/jpeg'),
    `${shot?.sizes} ${shot?.type} ${shot?.form_factor}`,
  );

  const fresh = await popup('http://localhost:8125/', 'popup-new.png');
  check('the popup offers to add a new site', (await fresh.view.locator('main').innerText()).includes('Add in Tabulous'), fresh.errors.join('; '));
  await fresh.view.getByRole('button', { name: 'Add in Tabulous' }).click();
  await sleep(2500);
  const created = await storageGet('site:http://localhost:8125');
  check('"Add in Tabulous" saves a config using the site’s name and icons', created?.name === 'Site Own' && created?.icons?.length === 3, `${created?.name}, ${created?.icons?.length} icons`);
  check(
    '"Add in Tabulous" keeps the site’s own shortcuts and link handlers, with absolute URLs',
    created?.siteFields?.shortcuts?.[0]?.url === 'http://localhost:8125/compose' &&
      created?.siteFields?.protocol_handlers?.[0]?.url === 'http://localhost:8125/handle?u=%s' &&
      !('prefer_related_applications' in (created?.siteFields ?? {})),
    JSON.stringify(created?.siteFields),
  );
  await sleep(500);
  const kept = await (await ctx.newCDPSession(fresh.target)).send('Page.getAppManifest');
  check(
    'Chrome parses the carried-over shortcut and link handler',
    kept.errors.length === 0 &&
      kept.manifest?.shortcuts?.[0]?.url === 'http://localhost:8125/compose' &&
      kept.manifest?.protocolHandlers?.[0]?.url === 'http://localhost:8125/handle?u=%s',
    JSON.stringify({ errors: kept.errors, shortcuts: kept.manifest?.shortcuts, protocolHandlers: kept.manifest?.protocolHandlers }),
  );

  // The popup turns into a short setup form until Done is clicked.
  await fresh.view.screenshot({ path: `${SHOTS}/popup-setup.png`, fullPage: true });
  await fresh.view.emulateMedia({ colorScheme: 'dark' });
  await fresh.view.screenshot({ path: `${SHOTS}/popup-setup-dark.png`, fullPage: true });
  await fresh.view.emulateMedia({ colorScheme: 'light' });
  check('after "Add in Tabulous" the popup shows the setup form', created?.needsSetup === true && (await fresh.view.getByRole('button', { name: 'Done' }).count()) === 1);
  await fresh.view.getByLabel('Name').fill('Set Up Name');
  await fresh.view.getByLabel('In-app path').fill('/t/');
  await sleep(600);
  const edited = await storageGet('site:http://localhost:8125');
  check('typing in the setup form saves', edited?.name === 'Set Up Name' && edited?.scopePath === '/t/', `${edited?.name}, ${edited?.scopePath}`);
  await fresh.view.getByRole('button', { name: 'Done' }).click();
  await sleep(1000);
  const done = await storageGet('site:http://localhost:8125');
  const afterDone = await fresh.view.locator('main').innerText();
  check('Done ends setup and shows the status view', done && !('needsSetup' in done) && afterDone.includes('manifest is active'), afterDone.slice(0, 80).replace(/\n+/g, ' | '));
  // "Edit settings" reopens the form in the popup; the gear opens the settings page.
  await fresh.view.getByRole('button', { name: 'Edit', exact: true }).click();
  await sleep(300);
  await fresh.view.getByLabel('Name').fill('Edited Name');
  await sleep(600);
  const reedited = await storageGet('site:http://localhost:8125');
  check('"Edit" edits the site in the popup', reedited?.name === 'Edited Name' && !('needsSetup' in reedited), reedited?.name);
  await fresh.view.getByRole('button', { name: 'Done' }).click();
  await sleep(300);
  const settingsTab = ctx.waitForEvent('page');
  await fresh.view.getByRole('button', { name: 'Tabulous settings' }).click();
  const settingsUrl = (await settingsTab).url();
  check('the gear opens the settings page', settingsUrl.endsWith('/src/options/index.html'), settingsUrl);
  // On macOS the site access prompt can close the popup mid-click. The config
  // must already be saved by then, and the open tab must get the manifest
  // without a reload.
  const closing = await popup('http://localhost:8126/t/1', 'popup-closing.png');
  await closing.view.getByRole('button', { name: 'Add in Tabulous' }).click();
  await closing.view.close();
  await sleep(1500);
  const survived = await storageGet('site:http://localhost:8126');
  check('closing the popup straight after "Add in Tabulous" keeps the config', survived?.icons?.length === 3, `${survived?.name}, ${survived?.icons?.length} icons`);
  const openTab = ctx.pages().find((p) => p.url() === 'http://localhost:8126/t/1');
  const liveLinks = await openTab?.evaluate(() => [...document.querySelectorAll('link[rel~=manifest]')].map((l) => l.getAttribute('href').slice(0, 30)));
  check('the already-open tab gets the manifest without a reload', liveLinks?.length === 1 && liveLinks[0].startsWith('data:application/json'), JSON.stringify(liveLinks));
  // Maskable icons: the icon's own background fills the canvas edge to edge
  // and the artwork fits the safe-zone circle (radius 40% of the size).
  const bubble = await popup('http://localhost:8127/', 'popup-bubble.png');
  await bubble.view.getByRole('button', { name: 'Add in Tabulous' }).click();
  await sleep(1500);
  const bubbleIcons = (await storageGet('site:http://localhost:8127'))?.icons ?? [];
  const maskable = bubbleIcons.find((i) => i.purpose === 'maskable');
  const probe = maskable
    ? await bubble.view.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = new OffscreenCanvas(512, 512);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).join(',');
        // Blue reaches out to (but not past) the safe zone along the middle row.
        let edge = 256;
        while (edge < 511 && px(edge + 1, 256).startsWith('8,102,255')) edge++;
        return { corner: px(2, 2), centre: px(256, 256), radius: (edge + 1 - 256) / 512 };
      }, maskable.src)
    : undefined;
  fs.writeFileSync(path.join(SHOTS, 'maskable.png'), Buffer.from((maskable?.src ?? ',').split(',')[1], 'base64'));
  check(
    'the maskable icon keeps the icon’s background edge to edge, with the artwork inside the safe zone',
    probe?.corner === '255,255,255,255' && probe.centre.startsWith('8,102,255') && probe.radius > 0.37 && probe.radius <= 0.401,
    JSON.stringify(probe),
  );
} finally {
  await ctx?.close().catch(() => {});
  servers.forEach((s) => s.close());
  fs.rmSync(WORK, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots in e2e/screenshots/`);
process.exit(failed ? 1 : 0);

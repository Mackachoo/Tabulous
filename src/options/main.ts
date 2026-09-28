import { TAB_STRIP_FLAGS } from '../lib/flags';
import { blobToIcons, candidatesFromSite, iconsFromCandidates, largestIcon } from '../lib/icons';
import { hasSitePermission, removeSitePermission, requestSitePermission } from '../lib/permissions';
import { deleteSite, getAllSites, isSiteKey, saveSite } from '../lib/storage';
import {
  absoluteUrl,
  buildManifest,
  checkUrl,
  defaultSiteConfig,
  toOrigin,
  validate,
  type LaunchClientMode,
  type SiteConfig,
} from '../lib/web-manifest';
import { presetFor } from '../presets';
import { $, h, listRow, mount, notice, toggleRow, type Child } from '../ui/dom';
import { icon } from '../ui/icons';

type Tone = 'info' | 'warn' | 'error' | 'ok';

interface State {
  sites: SiteConfig[];
  permitted: Record<string, boolean>;
  selected?: string;
  draft?: SiteConfig;
  dirty: boolean;
  overridesText: string;
  overridesError?: string;
  message?: { tone: Tone; text: string };
  scopeInput: string;
}

const state: State = { sites: [], permitted: {}, dirty: false, overridesText: '{}', scopeInput: '' };
const root = $('#app');
const ONBOARDING_URL = chrome.runtime.getURL('src/onboarding/index.html');

// Parts of the editor that refresh on every keystroke without re-rendering the
// form (which would steal focus from the field being typed in).
const live = {
  problems: h('div', { class: 'stack' }),
  preview: h('pre', { class: 'json' }),
  scopeResult: h('div', { class: 'scope-result' }),
  saveBar: h('div', { class: 'editor-header' }),
};

async function loadSites(): Promise<void> {
  state.sites = await getAllSites();
  const permitted = await Promise.all(state.sites.map((s) => hasSitePermission(s.origin)));
  state.permitted = Object.fromEntries(state.sites.map((s, i) => [s.origin, permitted[i]]));
}

function select(origin: string | undefined): void {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const site = state.sites.find((s) => s.origin === origin);
  state.selected = site?.origin;
  state.draft = site && structuredClone(site);
  state.dirty = false;
  state.overridesText = JSON.stringify(site?.overrides ?? {}, null, 2);
  state.overridesError = undefined;
  state.message = undefined;
  state.scopeInput = site ? absoluteUrl(site.origin, site.startPath) : '';
  history.replaceState(null, '', site ? `#${encodeURIComponent(site.origin)}` : '#');
  render();
}

function change(patch: Partial<SiteConfig>): void {
  if (!state.draft) return;
  state.draft = { ...state.draft, ...patch };
  state.dirty = true;
  refreshLive();
}

function say(tone: Tone, text: string): void {
  state.message = { tone, text };
  render();
}

// ---- actions ---------------------------------------------------------------

async function addSite(input: string): Promise<void> {
  let origin: string;
  try {
    origin = toOrigin(input);
  } catch (e) {
    return say('error', (e as Error).message);
  }
  // Permission prompt first, while the click still counts as a user gesture.
  const granted = await requestSitePermission(origin);
  if (!state.sites.some((s) => s.origin === origin)) {
    await saveSite(defaultSiteConfig(origin, presetFor(origin)));
    await loadSites();
  }
  select(origin);
  if (granted) await fetchIcons();
  else say('warn', 'Tabulous was not given access to this site, so the manifest won’t be added until you grant it.');
}

async function save(): Promise<void> {
  if (!state.draft || state.overridesError) return;
  // Saving here counts as setting the site up, so the popup skips its setup form.
  const { needsSetup: _, ...config } = state.draft;
  await saveSite(config);
  state.dirty = false;
  await loadSites();
  state.message = { tone: 'ok', text: 'Saved. Open pages of this site update straight away.' };
  render();
}

async function remove(): Promise<void> {
  if (!state.draft || !confirm(`Remove ${state.draft.name} from Tabulous? Installed apps will fall back to the site’s own manifest.`)) return;
  const { origin } = state.draft;
  await deleteSite(origin);
  await removeSitePermission(origin);
  state.dirty = false;
  await loadSites();
  select(undefined);
}

async function grant(origin: string): Promise<void> {
  state.permitted[origin] = await requestSitePermission(origin);
  render();
}

async function fetchIcons(): Promise<void> {
  const draft = state.draft;
  if (!draft) return;
  say('info', 'Looking for icons on the site…');
  try {
    const candidates = await candidatesFromSite(absoluteUrl(draft.origin, draft.startPath));
    const { icons } = await iconsFromCandidates(candidates, draft.backgroundColor);
    if (!icons.length) return say('warn', 'No usable icons found on the site. Upload one instead.');
    change({ icons });
    say('ok', 'Icons updated from the site. Save to keep them.');
  } catch (e) {
    say('error', `Couldn’t load the site: ${(e as Error).message}`);
  }
}

async function uploadIcon(file: File): Promise<void> {
  if (!state.draft) return;
  try {
    change({ icons: await blobToIcons(file, state.draft.backgroundColor) });
    render();
  } catch {
    say('error', 'That file couldn’t be read as an image.');
  }
}

function exportSites(): void {
  const blob = new Blob([JSON.stringify({ tabulous: 1, sites: state.sites }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'tabulous-sites.json' });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importSites(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text());
    const sites = (Array.isArray(data?.sites) ? data.sites : []) as Partial<SiteConfig>[];
    let count = 0;
    for (const site of sites) {
      if (typeof site.origin !== 'string') continue;
      const origin = toOrigin(site.origin);
      await saveSite(defaultSiteConfig(origin, { ...site, origin }));
      count++;
    }
    await loadSites();
    say('ok', `Imported ${count} site${count === 1 ? '' : 's'}. Grant access to each one to turn it on.`);
  } catch (e) {
    say('error', `Import failed: ${(e as Error).message}`);
  }
}

// ---- fields ----------------------------------------------------------------

type StringKey = 'name' | 'shortName' | 'startPath' | 'scopePath' | 'newTabPath';

function textField(label: string, key: StringKey, hint?: string, placeholder?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('input', {
      type: 'text',
      value: state.draft?.[key] ?? '',
      placeholder,
      oninput: (e: Event) => change({ [key]: (e.target as HTMLInputElement).value || undefined }),
    }),
    hint && h('span', { class: 'hint' }, hint),
  );
}

function colorField(label: string, key: 'themeColor' | 'backgroundColor', hint: string): HTMLElement {
  const value = state.draft?.[key] ?? '';
  const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  const text = h('input', { type: 'text', value, placeholder: 'None' });
  const picker = h('input', { type: 'color', value: isHex(value) ? value : '#000000', 'aria-label': `${label} picker` });
  text.addEventListener('input', () => {
    change({ [key]: text.value.trim() || undefined });
    if (isHex(text.value)) picker.value = text.value;
  });
  picker.addEventListener('input', () => {
    text.value = picker.value;
    change({ [key]: picker.value });
  });
  return h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'color-field' }, picker, text), h('span', { class: 'hint' }, hint));
}

function linesField(label: string, value: string[], hint: string, placeholder: string, onchange: (lines: string[]) => void): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('textarea', {
      rows: 3,
      value: value.join('\n'),
      placeholder,
      oninput: (e: Event) => onchange((e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean)),
    }),
    h('span', { class: 'hint' }, hint),
  );
}

/** A settings section: a title above a card, as in chrome://settings. */
function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'settings-section' }, h('h2', null, title), h('div', { class: 'card' }, ...children));
}

function siteIcon(site: SiteConfig, size = 32): HTMLElement {
  const best = largestIcon(site.icons);
  return best
    ? h('img', { class: 'site-icon', src: best.src, alt: '', style: `width:${size}px;height:${size}px` })
    : h('span', { class: 'site-icon', style: `width:${size}px;height:${size}px` }, icon('apps', size * 0.6));
}

// ---- rendering -------------------------------------------------------------

function toolbar(): HTMLElement {
  const importInput = h('input', {
    type: 'file',
    accept: 'application/json',
    hidden: true,
    onchange: () => importInput.files?.[0] && importSites(importInput.files[0]),
  });
  return h(
    'header',
    { class: 'toolbar' },
    h('img', { src: chrome.runtime.getURL('icons/icon-48.png'), alt: '', width: 28, height: 28 }),
    h('h1', null, 'Tabulous'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn text', onclick: () => importInput.click() }, icon('upload', 18), 'Import'),
    h('button', { class: 'btn text', onclick: exportSites, disabled: !state.sites.length }, icon('download', 18), 'Export'),
    importInput,
  );
}

function sidebar(): HTMLElement {
  const addInput = h('input', { type: 'text', placeholder: 'example.com', 'aria-label': 'Site to add' });
  return h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Sites' },
    h(
      'div',
      { class: 'nav-list' },
      ...state.sites.map((site) =>
        h(
          'button',
          {
            class: `nav-item${site.enabled ? '' : ' disabled'}`,
            'aria-current': site.origin === state.selected ? 'page' : 'false',
            onclick: () => select(site.origin),
          },
          siteIcon(site, 20),
          h('span', { class: 'nav-item-text' }, h('span', null, site.name), h('span', { class: 'hint' }, state.permitted[site.origin] ? new URL(site.origin).host : 'Needs access')),
        ),
      ),
    ),
    h(
      'form',
      {
        class: 'add-site',
        onsubmit: (e: Event) => {
          e.preventDefault();
          addSite(addInput.value);
        },
      },
      addInput,
      h('button', { class: 'btn', type: 'submit' }, icon('add', 18), 'Add site'),
    ),
    h('hr'),
    h('button', { class: 'nav-item', onclick: () => chrome.tabs.create({ url: ONBOARDING_URL }) }, icon('flag', 20), h('span', { class: 'nav-item-text' }, 'Chrome flags for tabs')),
  );
}

function editor(draft: SiteConfig): HTMLElement {
  const uploadInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onchange: () => uploadInput.files?.[0] && uploadIcon(uploadInput.files[0]),
  });

  const main = h(
    'div',
    { class: 'editor-main' },
    state.message && notice(state.message.tone, state.message.text),
    !state.permitted[draft.origin] &&
      notice('error', 'Tabulous doesn’t have access to this site, so the manifest isn’t being added.', h('button', { class: 'btn', onclick: () => grant(draft.origin) }, 'Allow access')),

    section(
      'App',
      toggleRow('Use Tabulous on this site', 'Replace the site’s web app manifest with this one', draft.enabled, (enabled) => change({ enabled })),
      h(
        'div',
        { class: 'card-body form-grid' },
        textField('Name', 'name'),
        textField('Short name', 'shortName', 'Shown under the icon in the Dock or launcher.'),
        textField('Start page', 'startPath', 'Where the app opens.', '/'),
        textField('In-app path', 'scopePath', 'Pages under this path stay in the app. Anything else shows the URL bar.', '/'),
        colorField('Title bar colour', 'themeColor', 'The app window’s title bar and tab strip.'),
        colorField('Background colour', 'backgroundColor', 'Shown while the app loads.'),
      ),
    ),

    section(
      'Icons',
      h(
        'div',
        { class: 'card-body stack' },
        draft.icons.length
          ? h(
              'div',
              { class: 'icons' },
              ...draft.icons.map((i) =>
                h('figure', null, h('img', { src: i.src, alt: '', class: i.purpose === 'maskable' ? 'maskable' : '' }), h('figcaption', null, `${i.sizes ?? '?'} ${i.purpose ?? ''}`)),
              ),
            )
          : h('p', { class: 'secondary' }, 'No icons yet. Chrome won’t install the app without one.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: fetchIcons, disabled: !state.permitted[draft.origin] }, icon('refresh', 18), 'Get icons from site'),
          h('button', { class: 'btn', onclick: () => uploadInput.click() }, icon('upload', 18), 'Upload image'),
          uploadInput,
        ),
      ),
    ),

    section(
      'Tabbed window',
      toggleRow('Tabbed app window', 'Show a tab strip so several pages of the app can be open in one window', draft.tabbed, (tabbed) => {
        change({ tabbed });
        render();
      }),
      draft.tabbed &&
        h(
          'div',
          { class: 'card-body stack' },
          linesField(
            'Home tab pages',
            draft.homeTabPaths,
            'URL patterns, one per line, for the pinned home tab. Links to these pages open in it. Leave empty for no home tab.',
            '/\n/inbox/*',
            (homeTabPaths) => change({ homeTabPaths }),
          ),
          textField('New tab page', 'newTabPath', 'What the + button opens. Must be outside the home tab pages.', '/'),
        ),
      draft.tabbed &&
        listRow(
          'Chrome flags',
          ['The tab strip only appears when ', ...TAB_STRIP_FLAGS.filter((f) => f.required).flatMap((f, i) => [i ? ' and ' : '', h('code', null, f.id)]), ' are on.'],
          h('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: ONBOARDING_URL }) }, icon('flag', 18), 'Set up flags'),
        ),
    ),

    section(
      'Behaviour',
      h(
        'div',
        { class: 'card-body stack' },
        h(
          'label',
          { class: 'field' },
          h('span', null, 'When a link to the app is opened'),
          h(
            'select',
            { onchange: (e: Event) => change({ launchMode: (e.target as HTMLSelectElement).value as LaunchClientMode }) },
            ...(
              [
                ['auto', 'Let Chrome decide'],
                ['focus-existing', 'Focus the open app window'],
                ['navigate-existing', 'Open it in the open app window'],
                ['navigate-new', 'Open a new app window'],
              ] as const
            ).map(([value, label]) => h('option', { value, selected: draft.launchMode === value }, label)),
          ),
        ),
        linesField(
          'Shortcuts',
          draft.shortcuts.map((s) => `${s.name} | ${s.path}`),
          'Shown when you right-click the app icon. One per line: Name | /path',
          'New message | /new',
          (lines) =>
            change({
              shortcuts: lines.map((line) => {
                const [name, path = ''] = line.split('|').map((part) => part.trim());
                return { name, path };
              }),
            }),
        ),
      ),
    ),

    section(
      'Advanced',
      toggleRow(
        'Remove the site’s Content-Security-Policy',
        'Only needed when the site’s policy blocks the Tabulous manifest (the popup tells you). Makes the site less protected if it has a script injection bug.',
        draft.cspBypass,
        (cspBypass) => change({ cspBypass }),
      ),
      h(
        'div',
        { class: 'card-body' },
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Extra manifest fields (JSON)'),
          h('textarea', {
            rows: 5,
            value: state.overridesText,
            oninput: (e: Event) => {
              state.overridesText = (e.target as HTMLTextAreaElement).value;
              try {
                const parsed = JSON.parse(state.overridesText || '{}');
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Must be a JSON object.');
                state.overridesError = undefined;
                change({ overrides: parsed });
              } catch (err) {
                state.overridesError = (err as Error).message;
                refreshLive();
              }
            },
          }),
          h('span', { class: 'hint' }, 'Merged over the generated manifest, e.g. {"orientation": "portrait"}. Use absolute URLs.'),
        ),
      ),
    ),
  );

  const side = h(
    'div',
    { class: 'editor-side' },
    h('section', { class: 'settings-section' }, h('h2', null, 'Status'), live.problems),
    section(
      'Is this URL in the app?',
      h(
        'div',
        { class: 'card-body stack' },
        h('input', {
          type: 'url',
          value: state.scopeInput,
          'aria-label': 'URL to test',
          oninput: (e: Event) => {
            state.scopeInput = (e.target as HTMLInputElement).value;
            refreshLive();
          },
        }),
        live.scopeResult,
      ),
    ),
    section('Generated manifest', h('div', { class: 'card-body' }, live.preview)),
  );

  refreshLive();
  return h('div', { class: 'editor' }, live.saveBar, h('div', { class: 'editor-columns' }, main, side));
}

function refreshLive(): void {
  const draft = state.draft;
  if (!draft) return;

  const problems = validate(draft);
  if (state.overridesError) problems.unshift({ severity: 'error', message: `Extra manifest fields: ${state.overridesError}` });
  mount(
    live.problems,
    h(
      'div',
      { class: 'stack' },
      problems.length ? problems.map((p) => notice(p.severity === 'error' ? 'error' : 'warn', p.message)) : notice('ok', 'Ready to install.'),
    ),
  );

  try {
    const manifest = buildManifest(draft);
    // Data URLs make the preview unreadable; show where they'd be instead.
    const icons = manifest.icons.map((i) => ({ ...i, src: `${i.src.slice(0, 32)}…` }));
    live.preview.textContent = JSON.stringify({ ...manifest, icons }, null, 2);
  } catch (e) {
    live.preview.textContent = `Can’t build the manifest: ${(e as Error).message}`;
  }

  let result: { text: string; inApp?: boolean };
  try {
    const check = checkUrl(draft, state.scopeInput);
    result = !check.inScope
      ? { text: 'Outside the app: Chrome shows the URL bar', inApp: false }
      : { text: check.homeTab ? 'In the app, home tab' : 'In the app', inApp: true };
  } catch {
    result = { text: 'Enter a full URL' };
  }
  live.scopeResult.className = `scope-result${result.inApp === undefined ? '' : result.inApp ? ' in' : ' out'}`;
  mount(live.scopeResult, result.inApp !== undefined && icon(result.inApp ? 'checkCircle' : 'warning', 16), result.text);

  mount(
    live.saveBar,
    siteIcon(draft, 40),
    h('div', { class: 'editor-title' }, h('h1', null, draft.name || draft.origin), h('div', { class: 'secondary' }, draft.origin)),
    state.dirty && h('span', { class: 'secondary' }, 'Unsaved changes'),
    h('button', { class: 'btn danger', onclick: remove }, icon('delete', 18), 'Remove'),
    h('button', { class: 'btn action', onclick: save, disabled: !state.dirty || Boolean(state.overridesError) }, 'Save'),
  );
}

function render(): void {
  const content = state.draft
    ? editor(state.draft)
    : h(
        'div',
        { class: 'empty' },
        state.message && notice(state.message.tone, state.message.text),
        h(
          'div',
          { class: 'card card-body empty-card' },
          h('span', { class: 'site-icon', style: 'width:48px;height:48px' }, icon('apps', 28)),
          h('h1', null, state.sites.length ? 'Choose a site' : 'Turn a site into an app'),
          h(
            'p',
            { class: 'secondary' },
            'Open a site and click the Tabulous icon in the toolbar, or add one on the left. Tabulous gives it a web app manifest you control: a tabbed window, the right in-app pages, icons and more.',
          ),
        ),
      );
  mount(root, toolbar(), h('div', { class: 'layout' }, sidebar(), h('main', { class: 'content' }, content)));
}

async function init(): Promise<void> {
  await loadSites();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  select(state.sites.some((s) => s.origin === fromHash) ? fromHash : undefined);
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(isSiteKey)) return;
  await loadSites();
  // Pick up edits made in the popup unless the user is mid-edit here.
  if (!state.dirty && state.selected) {
    const fresh = state.sites.find((s) => s.origin === state.selected);
    state.draft = fresh && structuredClone(fresh);
    if (!fresh) state.selected = undefined;
  }
  render();
});
chrome.permissions.onAdded.addListener(() => loadSites().then(render));
chrome.permissions.onRemoved.addListener(() => loadSites().then(render));

init();

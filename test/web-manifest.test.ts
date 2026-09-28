import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  appId,
  buildManifest,
  checkUrl,
  defaultSiteConfig,
  manifestDataUrl,
  normaliseScopePath,
  siteManifestFields,
  toOrigin,
  validate,
  type SiteConfig,
} from '../src/lib/web-manifest';
import { messengerPreset } from '../src/presets/messenger';

const icon = { src: 'data:image/png;base64,AAAA', sizes: '512x512', type: 'image/png', purpose: 'any' };
const site = (partial: Partial<SiteConfig> = {}) =>
  defaultSiteConfig('https://www.messenger.com', { icons: [icon], ...partial });

describe('toOrigin', () => {
  it('accepts bare hosts and full URLs', () => {
    expect(toOrigin('messenger.com')).toBe('https://messenger.com');
    expect(toOrigin(' https://www.messenger.com/t/123?x=1 ')).toBe('https://www.messenger.com');
    expect(toOrigin('http://localhost:8080/app')).toBe('http://localhost:8080');
  });

  it('rejects non-web schemes', () => {
    expect(() => toOrigin('chrome://flags')).toThrow();
  });
});

describe('absoluteUrl', () => {
  it('resolves paths against the origin', () => {
    expect(absoluteUrl('https://a.com', '/x?y')).toBe('https://a.com/x?y');
    expect(absoluteUrl('https://a.com', '')).toBe('https://a.com/');
  });

  it('refuses other origins', () => {
    expect(() => absoluteUrl('https://a.com', 'https://b.com/')).toThrow();
  });
});

describe('normaliseScopePath', () => {
  it('makes a directory prefix', () => {
    expect(normaliseScopePath('')).toBe('/');
    expect(normaliseScopePath('t')).toBe('/t/');
    expect(normaliseScopePath('/app/')).toBe('/app/');
  });
});

describe('buildManifest', () => {
  it('writes only absolute URLs, since the manifest is a data: URL', () => {
    const m = buildManifest(site({ startPath: '/t/1', newTabPath: '/new', shortcuts: [{ name: 'New', path: '/new' }] }));
    expect(m.id).toBe('https://www.messenger.com/?tabulous');
    expect(m.start_url).toBe('https://www.messenger.com/t/1');
    expect(m.scope).toBe('https://www.messenger.com/');
    expect(m.tab_strip?.new_tab_button?.url).toBe('https://www.messenger.com/new');
    expect(m.shortcuts).toEqual([{ name: 'New', url: 'https://www.messenger.com/new' }]);
  });

  it('always sets an explicit scope, so installing from a deep page keeps the whole site in the app', () => {
    const m = buildManifest(site({ startPath: '/t/123' }));
    expect(m.scope).toBe('https://www.messenger.com/');
  });

  it('falls back to standalone when tabbed mode is unavailable', () => {
    expect(buildManifest(site({ tabbed: true })).display_override).toEqual(['tabbed', 'standalone']);
    expect(buildManifest(site({ tabbed: false })).display_override).toEqual(['standalone']);
    expect(buildManifest(site({ tabbed: false, newTabPath: '/' })).tab_strip).toBeUndefined();
  });

  it('spells out every URL pattern component for the home tab', () => {
    const m = buildManifest(site({ homeTabPaths: ['/', ' '] }));
    expect(m.tab_strip?.home_tab?.scope_patterns).toEqual([
      { protocol: 'https', hostname: 'www.messenger.com', port: '', pathname: '/', search: '*', hash: '*' },
    ]);
  });

  it('omits empty optional members', () => {
    const m = buildManifest(site({ homeTabPaths: [], newTabPath: undefined }));
    expect(m).not.toHaveProperty('tab_strip');
    expect(m).not.toHaveProperty('launch_handler');
    expect(m).not.toHaveProperty('shortcuts');
  });

  it('applies raw overrides last', () => {
    const m = buildManifest(site({ overrides: { orientation: 'portrait', display: 'minimal-ui' } }));
    expect(m.orientation).toBe('portrait');
    expect(m.display).toBe('minimal-ui');
  });

  it('keeps the id stable across config changes', () => {
    expect(buildManifest(site({ startPath: '/a' })).id).toBe(buildManifest(site({ startPath: '/b', name: 'X' })).id);
    expect(appId('http://localhost:8080')).toBe('http://localhost:8080/?tabulous');
  });
});

describe('siteManifestFields', () => {
  const MANIFEST_URL = 'https://www.messenger.com/static/app.webmanifest';
  const read = (manifest: Record<string, unknown>) => siteManifestFields(manifest, MANIFEST_URL, 'https://www.messenger.com');

  it('keeps features Tabulous doesn’t generate and drops the ones it does', () => {
    const fields = read({
      id: '/',
      name: 'Site',
      start_url: '/',
      scope: '/t/',
      display: 'standalone',
      icons: [{ src: 'i.png' }],
      theme_color: '#000',
      prefer_related_applications: true,
      related_applications: [{ platform: 'play' }],
      description: 'Chat',
      categories: ['social', 3],
      handle_links: 'preferred',
    });
    expect(fields).toEqual({ description: 'Chat', categories: ['social'], handle_links: 'preferred' });
  });

  it('resolves URLs against the manifest, keeping %s in link handlers', () => {
    const fields = read({
      shortcuts: [{ name: 'New', url: '/new', icons: [{ src: 'new.png', sizes: '96x96' }] }],
      protocol_handlers: [{ protocol: 'mailto', url: 'compose?to=%s' }],
      share_target: { action: '/share', method: 'GET', params: { text: 't' } },
      file_handlers: [{ action: '/open', accept: { 'text/plain': ['.txt'] } }],
      screenshots: [{ src: 'https://cdn.example/shot.png', sizes: '1280x800', form_factor: 'wide' }],
    });
    expect(fields.shortcuts).toEqual([
      { name: 'New', url: 'https://www.messenger.com/new', icons: [{ src: 'https://www.messenger.com/static/new.png', sizes: '96x96' }] },
    ]);
    expect(fields.protocol_handlers).toEqual([{ protocol: 'mailto', url: 'https://www.messenger.com/static/compose?to=%s' }]);
    expect(fields.share_target).toEqual({ action: 'https://www.messenger.com/share', method: 'GET', params: { text: 't' } });
    expect(fields.file_handlers).toEqual([{ action: 'https://www.messenger.com/open', accept: { 'text/plain': ['.txt'] } }]);
    expect(fields.screenshots).toEqual([{ src: 'https://cdn.example/shot.png', sizes: '1280x800', form_factor: 'wide' }]);
  });

  it('drops pages on other origins and malformed entries', () => {
    const fields = read({
      shortcuts: [{ name: 'Elsewhere', url: 'https://evil.example/' }, 'nope', { name: 'No URL' }],
      share_target: { action: 'https://other.example/share' },
      screenshots: [{ src: 'javascript:alert(1)' }],
    });
    expect(fields).toEqual({});
  });
});

describe('buildManifest with the site’s own fields', () => {
  const siteFields = {
    description: 'From the site',
    shortcuts: [{ name: 'Site shortcut', url: 'https://www.messenger.com/s' }],
    protocol_handlers: [{ protocol: 'mailto', url: 'https://www.messenger.com/m?to=%s' }],
    scope: 'https://www.messenger.com/nope/',
  };

  it('adds them under the generated members, with overrides on top', () => {
    const m = buildManifest(site({ siteFields, overrides: { description: 'Override' } }));
    expect(m.protocol_handlers).toEqual(siteFields.protocol_handlers);
    expect(m.shortcuts).toEqual(siteFields.shortcuts);
    expect(m.scope).toBe('https://www.messenger.com/');
    expect(m.description).toBe('Override');
  });

  it('lets the user’s shortcuts replace the site’s', () => {
    const m = buildManifest(site({ siteFields, shortcuts: [{ name: 'Mine', path: '/mine' }] }));
    expect(m.shortcuts).toEqual([{ name: 'Mine', url: 'https://www.messenger.com/mine' }]);
  });

  it('leaves them out when turned off, and keeps them for configs saved before the setting', () => {
    expect(buildManifest(site({ siteFields, keepSiteFields: false }))).not.toHaveProperty('protocol_handlers');
    expect(buildManifest(site({ siteFields, keepSiteFields: undefined }))).toHaveProperty('protocol_handlers');
  });

  it('warns about site entries outside the in-app path', () => {
    const problems = validate(site({ siteFields, scopePath: '/t/', startPath: '/t/' }));
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringContaining('1 of the site’s own shortcuts is outside'),
      expect.stringContaining('1 of the site’s own link handlers is outside'),
    ]);
    expect(validate(site({ siteFields, scopePath: '/t/', startPath: '/t/', keepSiteFields: false }))).toEqual([]);
  });
});

describe('checkUrl', () => {
  it('treats the whole origin as in the app for the Messenger preset', () => {
    const messenger = site(messengerPreset);
    expect(checkUrl(messenger, 'https://www.messenger.com/t/123').inScope).toBe(true);
    expect(checkUrl(messenger, 'https://www.messenger.com/t/456').inScope).toBe(true);
    expect(checkUrl(messenger, 'https://www.facebook.com/').inScope).toBe(false);
  });

  it('does not treat /terms as inside /t/', () => {
    const narrow = site({ scopePath: '/t', startPath: '/t/' });
    expect(checkUrl(narrow, 'https://www.messenger.com/t/1').inScope).toBe(true);
    expect(checkUrl(narrow, 'https://www.messenger.com/t').inScope).toBe(true);
    expect(checkUrl(narrow, 'https://www.messenger.com/terms').inScope).toBe(false);
  });

  it('matches home tab patterns', () => {
    const cfg = site({ homeTabPaths: ['/inbox/*'] });
    expect(checkUrl(cfg, 'https://www.messenger.com/inbox/1?x#y').homeTab).toBe(true);
    expect(checkUrl(cfg, 'https://www.messenger.com/t/1').homeTab).toBe(false);
    expect(checkUrl({ ...cfg, tabbed: false }, 'https://www.messenger.com/inbox/1').homeTab).toBe(false);
  });
});

describe('validate', () => {
  it('passes a complete config', () => {
    expect(validate(site())).toEqual([]);
  });

  it('requires an icon', () => {
    expect(validate(site({ icons: [] })).map((p) => p.severity)).toContain('error');
  });

  it('warns about small icons', () => {
    const problems = validate(site({ icons: [{ ...icon, sizes: '32x32' }] }));
    expect(problems).toEqual([expect.objectContaining({ severity: 'warning' })]);
  });

  it('requires the start page to be inside the scope', () => {
    const problems = validate(site({ scopePath: '/t/', startPath: '/' }));
    expect(problems.some((p) => p.severity === 'error' && p.message.includes('start page'))).toBe(true);
  });

  it('warns when the new tab page is inside the home tab', () => {
    const problems = validate(site({ homeTabPaths: ['/*'], newTabPath: '/new' }));
    expect(problems.some((p) => p.message.includes('new tab button'))).toBe(true);
  });
});

describe('manifestDataUrl', () => {
  it('round-trips non-Latin-1 names', () => {
    const manifest = buildManifest(site({ name: 'Mésséngér 💬' }));
    const url = manifestDataUrl(manifest);
    expect(url.startsWith('data:application/json;base64,')).toBe(true);
    const json = new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)));
    expect(JSON.parse(json).name).toBe('Mésséngér 💬');
  });
});

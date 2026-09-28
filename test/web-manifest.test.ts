import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  appId,
  buildManifest,
  checkUrl,
  defaultSiteConfig,
  manifestDataUrl,
  normaliseScopePath,
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

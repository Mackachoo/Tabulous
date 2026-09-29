import { describe, expect, it } from 'vitest';
import { pageCss } from '../src/lib/page-css';
import { buildManifest, defaultSiteConfig, isHandledScheme, validate, type SiteConfig } from '../src/lib/web-manifest';

const icon = { src: 'data:image/png;base64,AAAA', sizes: '512x512', type: 'image/png', purpose: 'any' };
const site = (partial: Partial<SiteConfig> = {}) => defaultSiteConfig('https://mail.example.com', { icons: [icon], ...partial });

describe('window style', () => {
  it('uses the chosen display, after tabs or the title bar overlay', () => {
    expect(buildManifest(site({ tabbed: true, display: 'minimal-ui' }))).toMatchObject({
      display: 'minimal-ui',
      display_override: ['tabbed', 'minimal-ui'],
    });
    expect(buildManifest(site({ tabbed: false, display: 'fullscreen' })).display_override).toEqual(['fullscreen']);
    expect(buildManifest(site({ tabbed: false, titleBarOverlay: true })).display_override).toEqual(['window-controls-overlay', 'standalone']);
  });

  it('ignores the title bar overlay when tabbed, since Chrome can’t do both', () => {
    expect(buildManifest(site({ tabbed: true, titleBarOverlay: true })).display_override).toEqual(['tabbed', 'standalone']);
  });

  it('treats configs saved before the setting as standalone', () => {
    expect(buildManifest(site({ display: undefined })).display).toBe('standalone');
  });

  it('warns when the overlay has no drag area', () => {
    const warning = expect.objectContaining({ message: expect.stringContaining('no drag area') });
    expect(validate(site({ tabbed: false, titleBarOverlay: true }))).toContainEqual(warning);
    expect(validate(site({ tabbed: false, titleBarOverlay: true, dragSelector: 'header' }))).toEqual([]);
  });
});

describe('link handlers', () => {
  it('writes absolute URLs and replaces the site’s handler for the same scheme', () => {
    const siteFields = {
      protocol_handlers: [
        { protocol: 'mailto', url: 'https://mail.example.com/site?to=%s' },
        { protocol: 'webcal', url: 'https://mail.example.com/cal?u=%s' },
      ],
    };
    const m = buildManifest(site({ siteFields, protocolHandlers: [{ protocol: ' MailTo ', path: '/compose?to=%s' }] }));
    expect(m.protocol_handlers).toEqual([
      { protocol: 'webcal', url: 'https://mail.example.com/cal?u=%s' },
      { protocol: 'mailto', url: 'https://mail.example.com/compose?to=%s' },
    ]);
  });

  it('leaves the site’s handlers alone when there are none of the user’s', () => {
    const siteFields = { protocol_handlers: [{ protocol: 'mailto', url: 'https://mail.example.com/site?to=%s' }] };
    expect(buildManifest(site({ siteFields, protocolHandlers: [{ protocol: '', path: '' }] })).protocol_handlers).toEqual(siteFields.protocol_handlers);
  });

  it('accepts safelisted and web+ schemes only', () => {
    expect(isHandledScheme('mailto')).toBe(true);
    expect(isHandledScheme('web+music')).toBe(true);
    expect(isHandledScheme('http')).toBe(false);
    expect(isHandledScheme('web+')).toBe(false);
    expect(isHandledScheme('slack')).toBe(false);
  });

  it('validates scheme, %s and scope', () => {
    const messages = (protocol: string, path: string, extra: Partial<SiteConfig> = {}) =>
      validate(site({ protocolHandlers: [{ protocol, path }], ...extra })).map((p) => `${p.severity}: ${p.message}`);
    expect(messages('mailto', '/compose?to=%s')).toEqual([]);
    expect(messages('slack', '/x?u=%s')).toEqual([expect.stringMatching(/^error: .*standard schemes/)]);
    expect(messages('mailto', '/compose')).toEqual([expect.stringMatching(/^error: .*needs %s/)]);
    expect(messages('mailto', '/compose?to=%s', { scopePath: '/inbox/', startPath: '/inbox/' })).toEqual([expect.stringMatching(/^warning: .*outside the in-app path/)]);
  });
});

describe('shortcuts, description and screenshots', () => {
  it('adds shortcut descriptions and icons only when set', () => {
    const m = buildManifest(
      site({
        shortcuts: [
          { name: 'Compose', path: '/compose', description: ' Write an email ', icon: 'data:image/png;base64,BB' },
          { name: 'Inbox', path: '/inbox', description: ' ' },
        ],
      }),
    );
    expect(m.shortcuts).toEqual([
      {
        name: 'Compose',
        url: 'https://mail.example.com/compose',
        description: 'Write an email',
        icons: [{ src: 'data:image/png;base64,BB', sizes: '96x96', type: 'image/png' }],
      },
      { name: 'Inbox', url: 'https://mail.example.com/inbox' },
    ]);
  });

  it('uses the user’s description and screenshot over the site’s', () => {
    const screenshot = { src: 'data:image/jpeg;base64,CC', sizes: '1280x800', type: 'image/jpeg', form_factor: 'wide' as const };
    const siteFields = { description: 'Site', screenshots: [{ src: 'https://cdn.example/a.png' }] };
    expect(buildManifest(site({ siteFields }))).toMatchObject(siteFields);
    expect(buildManifest(site({ siteFields, description: 'Mine', screenshots: [screenshot] }))).toMatchObject({
      description: 'Mine',
      screenshots: [screenshot],
    });
  });
});

describe('pageCss', () => {
  it('makes the drag area draggable in the title bar overlay, but not its controls', () => {
    const css = pageCss(site({ tabbed: false, titleBarOverlay: true, dragSelector: 'header, #top' }));
    expect(css).toContain('@media (display-mode: window-controls-overlay)');
    expect(css).toContain(':is(header, #top) {\n    app-region: drag;');
    expect(css).toMatch(/:is\(header, #top\) :is\(a, button.*\) \{\n\s*app-region: no-drag;/);
  });

  it('adds nothing without the overlay or a selector, or when tabbed', () => {
    expect(pageCss(site({ tabbed: false, dragSelector: 'header' }))).toBe('');
    expect(pageCss(site({ tabbed: false, titleBarOverlay: true }))).toBe('');
    expect(pageCss(site({ tabbed: true, titleBarOverlay: true, dragSelector: 'header' }))).toBe('');
  });
});

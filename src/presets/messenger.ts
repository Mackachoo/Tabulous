import type { SiteConfig } from '../lib/web-manifest';

/**
 * Messenger's own manifest leaves the scope to Chrome, so an app installed from
 * a conversation (`/t/123`) is scoped to `/t/` and anything else shows the URL
 * bar. Scoping to the whole origin keeps every conversation in the app.
 */
export const messengerPreset: Partial<SiteConfig> = {
  name: 'Messenger',
  shortName: 'Messenger',
  startPath: '/',
  scopePath: '/',
  tabbed: true,
  homeTabPaths: [],
  newTabPath: '/',
  themeColor: '#0866ff',
};

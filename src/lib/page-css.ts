// CSS Tabulous adds to a site's pages. The content script asks the service
// worker to insert it with chrome.scripting.insertCSS, which the page's CSP
// can't block the way it can block a <style> element.

import type { SiteConfig } from './web-manifest';

const CONTROLS = 'a, button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]';

export function pageCss(config: SiteConfig): string {
  const rules: string[] = [];
  const drag = config.dragSelector?.trim();
  if (config.titleBarOverlay && !config.tabbed && drag) {
    // The titlebar-area variables mark the part of the title bar the window
    // controls leave free, so the padding keeps the page out from under them.
    rules.push(`@media (display-mode: window-controls-overlay) {
  :is(${drag}) {
    app-region: drag;
    box-sizing: border-box;
    padding-left: env(titlebar-area-x, 0);
    padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
  }
  :is(${drag}) :is(${CONTROLS}) {
    app-region: no-drag;
  }
}`);
  }
  return rules.join('\n');
}

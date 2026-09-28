# Appify

A Chrome extension that gives any website a web app manifest you control, so it installs as a proper app, including **tabbed app windows**.

- **Tabbed apps.** Adds `display_override: ["tabbed"]` and `tab_strip` (pinned home tab, new tab button) to any site.
- **The right pages stay in the app.** Sets an explicit `scope` so moving around the site doesn't bring up the URL bar. Messenger is the classic case: install it from a conversation (`/t/123`) and Chrome scopes the app to `/t/`, so every other page counts as "outside" the app.
- **Makes non-PWA sites installable** with a name, icons, colours, shortcuts and link-handling behaviour.

## Setup

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `dist/`. For a dev build with hot reload, run `npm run dev` and load `dist/` the same way.

### Chrome flags for tabbed windows

Tabbed app windows are still experimental on desktop Chrome. Appify opens its setup page on install, with a button for each flag. Set them to **Enabled** and relaunch Chrome:

| Flag | Needed for |
| --- | --- |
| `chrome://flags/#enable-desktop-pwas-tab-strip` | The tab strip itself (required) |
| `chrome://flags/#enable-desktop-pwas-tab-strip-customizations` | Home tab and new tab button (required) |
| `chrome://flags/#enable-desktop-pwas-tab-strip-settings` | Chrome's own per-app tabbed switch (optional) |

Extensions can't read flags. Instead, when an installed Appify app opens, Appify checks its `display-mode`. If the app asked for tabs but opened without them, the toolbar icon shows **!** and the popup offers the flag setup again. Without the flags, apps open as normal standalone windows.

## Using it

1. Open the site and click the Appify toolbar icon, then **Appify this site**. Chrome asks for access to that one site. The manifest is applied to the open page straight away, with no reload needed.
2. Install it: Chrome menu ⋮ › Cast, save and share › Install page as app. If you had already installed the site as an app, uninstall that one first: Appify's app has its own id.

**Edit all settings** opens the editor. There you can set the in-app path, home tab patterns, the new tab page, icons, shortcuts, launch behaviour and raw extra manifest fields. It shows a live preview of the generated manifest and has a URL tester that shows whether a page will stay in the app.

## How it works

- A content script is registered at `document_start`, only for the sites you've added. It removes the site's `<link rel="manifest">` and adds `data:application/json;base64,…` in its place. A `MutationObserver` puts it back if a single-page app re-adds its own.
- Every URL in the manifest is absolute and every icon is a PNG data URL, because a data: manifest has no base URL.
- The manifest `id` is fixed per origin (`<origin>/?appify`), so Chrome's periodic manifest update checks keep matching the installed app.
- **CSP:** some sites' `Content-Security-Policy` (`manifest-src`/`default-src`) blocks data: manifests. Appify notices the violation and offers to remove the CSP header **for that site only**, using a `declarativeNetRequest` rule. This weakens the site's protection against script injection, so it's opt-in and can be undone. A CSP set in a `<meta>` tag can't be removed this way.

Built on the approach of [betterPWAs](https://github.com/benfredwells/betterPWAs) (data: manifest injection, CSP header rule) and [pwa-scope-fixer](https://github.com/kittizz/pwa-scope-fixer) (fixing scope by injecting the manifest).

## Development

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the manifest builder, scope checks and validation |
| `npm run e2e` | Builds, then runs the extension against local test sites in your installed Chrome (`/Applications/Google Chrome.app`), or in Chrome for Testing if that's missing (`npx playwright install chromium`). Set `CHROME_PATH` to use another build |
| `npm run typecheck` | TypeScript |
| `npm run icons` | Regenerates the toolbar icons |

The end-to-end run covers manifest replacement, Chrome parsing and installability, CSP detection and bypass, live edits, the popup being closed mid-setup (Chrome's site access prompt can close it on macOS), and the popup, editor and onboarding pages in light and dark mode. Branded Chrome ignores `--load-extension`, so the run loads the extension over a DevTools pipe (`Extensions.loadUnpacked`). It runs headless, where app windows can't open, so check tabbed windows by hand: install an app with the flags on, then confirm the tab strip, home tab and new tab button.

```
src/
  background/service-worker.ts   registers content scripts and CSP rules from stored configs, sets badges
  content/inject-manifest.ts     replaces the page's manifest; reports CSP blocks and display-mode
  lib/web-manifest.ts            SiteConfig → manifest, scope checks, validation
  lib/detect.ts                  page inspection run from the popup
  lib/icons.ts                   icon discovery and conversion to data URLs
  popup/  options/  onboarding/  the extension pages
  presets/                       starting settings for known sites (Messenger)
```

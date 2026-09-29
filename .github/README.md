# Tabulous

A Chrome extension that gives any website a web app manifest you control, so it installs as a proper app, including **tabbed app windows**.

- **Tabbed apps.** Adds `display_override: ["tabbed"]` and `tab_strip` (pinned home tab, new tab button) to any site.
- **The right pages stay in the app.** Sets an explicit `scope` so moving around the site doesn't bring up the URL bar. Messenger is the classic case: install it from a conversation (`/t/123`) and Chrome scopes the app to `/t/`, so every other page counts as "outside" the app.
- **Makes non-PWA sites installable** with a name, icons, colours, shortcuts and link-handling behaviour.
- **Keeps what the site already had.** Shortcuts, link (protocol) and file handlers, share target, description and screenshots from the site's own manifest are carried over, unless you turn that off.
- **More of the manifest, without writing JSON.** Window style (standard, with back and reload buttons, or fullscreen), the page drawn into the title bar (window controls overlay), `mailto:`/`webcal:`/`web+…` link handlers, shortcuts with icons and descriptions, and a description and screenshot for Chrome's larger install dialog.

## Setup

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `dist/`. For a dev build with hot reload, run `npm run dev` and load `dist/` the same way.

### Chrome flags for tabbed windows

Tabbed app windows are still experimental on desktop Chrome. Tabulous opens its setup page on install, with a button for each flag. Set them to **Enabled** and relaunch Chrome:

| Flag | Needed for |
| --- | --- |
| `chrome://flags/#enable-desktop-pwas-tab-strip` | The tab strip itself (required) |
| `chrome://flags/#enable-desktop-pwas-tab-strip-customizations` | Home tab and new tab button (required) |
| `chrome://flags/#enable-desktop-pwas-tab-strip-settings` | Chrome's own per-app tabbed switch (optional) |

Extensions can't read flags. Instead, when an installed Tabulous app opens, Tabulous checks its `display-mode`. If the app asked for tabs but opened without them, the toolbar icon shows **!** and the popup offers the flag setup again. Without the flags, apps open as normal standalone windows.

## Using it

1. Open the site and click the Tabulous toolbar icon, then **Add in Tabulous**. Chrome asks for access to that one site. The manifest is applied to the open page straight away, with no reload needed. The popup then shows the key settings (name and icon, start page and in-app path, tabs) for a quick check. Click **Done** when they look right.
2. Install it: Chrome menu ⋮ › Cast, save and share › Install page as app. If you had already installed the site as an app, uninstall that one first: the Tabulous app has its own id.

**Edit all settings** opens the editor. There you can set the in-app path, home tab patterns, the new tab page, icons, the window style, shortcuts, link handlers, launch behaviour and raw extra manifest fields. It shows a live preview of the generated manifest and has a URL tester that shows whether a page will stay in the app. **Save** opens the app's start page in a tab (reusing it on later saves). Opening the installed app from there, with **Open in app** in the address bar, is the quickest way to get it to pick up the changed manifest.

The popup's **Capture** button saves a screenshot of the page for Chrome's install dialog. It's cropped and scaled to the sizes Chrome accepts and saved as a JPEG.

## How it works

- A content script is registered at `document_start`, only for the sites you've added. It removes the site's `<link rel="manifest">` and adds `data:application/json;base64,…` in its place. A `MutationObserver` puts it back if a single-page app re-adds its own.
- Every URL in the manifest is absolute and every icon is a PNG data URL, because a data: manifest has no base URL.
- Features from the site's own manifest are read when you add the site (or with **Refresh from site** in the editor), with their URLs resolved against the site's manifest URL. Pages outside the site's origin are dropped, as are `prefer_related_applications` and `related_applications`, which can stop Chrome offering to install. Your own settings and extra fields take precedence.
- With the page in the title bar, the content script asks the service worker to add CSS (`chrome.scripting.insertCSS`, which the page's CSP can't block) that makes your drag area selector `app-region: drag`, keeps its links and buttons clickable, and pads it clear of the window controls. It only applies in the `window-controls-overlay` display mode.
- On macOS, Chrome uses the `maskable` icon, unmasked and full-bleed, as the app's Dock icon, and macOS rounds its corners. Appify builds it from the site's icon: a full-bleed square (like an Apple touch icon) is used as it is. An icon drawn on a rounded square, like Messenger's, has that square enlarged to fill the canvas. A bare logo is centred in the safe zone on white.
- The manifest `id` is fixed per origin (`<origin>/?tabulous`), so Chrome's periodic manifest update checks keep matching the installed app.
- **CSP:** some sites' `Content-Security-Policy` (`manifest-src`/`default-src`) blocks data: manifests. Tabulous notices the violation and offers to remove the CSP header **for that site only**, using a `declarativeNetRequest` rule. This weakens the site's protection against script injection, so it's opt-in and can be undone. A CSP set in a `<meta>` tag can't be removed this way.

Built on the approach of [betterPWAs](https://github.com/benfredwells/betterPWAs) (data: manifest injection, CSP header rule) and [pwa-scope-fixer](https://github.com/kittizz/pwa-scope-fixer) (fixing scope by injecting the manifest).

## Development

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the manifest builder, scope checks and validation |
| `npm run e2e` | Builds, then runs the extension against local test sites in your installed Chrome (`/Applications/Google Chrome.app`), or in Chrome for Testing if that's missing (`npx playwright install chromium`). Set `CHROME_PATH` to use another build |
| `npm run typecheck` | TypeScript |

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

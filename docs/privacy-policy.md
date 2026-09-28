# Tabulous Privacy Policy

_Last updated: 29 September 2026_

Tabulous is a Chrome extension that gives websites a web app manifest you control, so they can be installed as (tabbed) apps. This policy explains what data the extension handles.

## Summary

Tabulous does not collect, transmit, sell or share any personal data. Everything it stores stays on your device, in your browser.

## What Tabulous stores

Tabulous uses Chrome's local extension storage (`chrome.storage.local`) to save:

- **Your site settings.** For each site you add: its address (origin), the app name, colours, start page, in-app path, tab settings, shortcuts, and the icons you chose or that were taken from the site (as image data).
- **Status information.** Whether Chrome's tabbed app flags appear to be working, and which of your added sites have a security policy that blocked the app manifest.

This data never leaves your device. It is not synced to your Google account or sent to the developer or any third party. It is deleted when you remove a site in Tabulous or uninstall the extension.

## Network requests

Tabulous has no server and uses no analytics, tracking, advertising or third-party services. The only network requests it makes go to sites you have added and given it access to, in order to:

- read the site's existing manifest and icons, to fill in the app's name and icon, and
- check the site's response headers for a security policy that would block the app manifest.

These requests are made from your browser, like normal page loads, and their results are only used on your device.

## Permissions

- **Site access** is requested one site at a time, only when you add that site. You can revoke it at any time from Tabulous or from Chrome's extension settings.
- **`storage`** saves your settings locally, as described above.
- **`scripting`** and **`activeTab`** let Tabulous inspect the page you're on when you add it, and insert the app manifest on sites you've added.
- **`declarativeNetRequest`** is used only if you choose to remove a site's security policy header so that the manifest can load. It applies only to that site and can be undone.

Tabulous does not read or record the content of the pages you visit, your browsing history, form data or passwords.

## Changes

If this policy changes, the updated version will be posted here with a new date.

## Contact

Questions or concerns can be raised at [github.com/Mackachoo/Tabulous/issues](https://github.com/Mackachoo/Tabulous/issues).

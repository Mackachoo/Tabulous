// Chrome's desktop tab strip flags. Extensions can open chrome://flags but not
// change it, so Appify links straight to each flag and lets the user flip it.

export interface ChromeFlag {
  id: string;
  title: string;
  why: string;
  required: boolean;
}

export const TAB_STRIP_FLAGS: ChromeFlag[] = [
  {
    id: 'enable-desktop-pwas-tab-strip',
    title: 'Desktop PWA tab strips',
    why: 'Turns on the tabbed display mode, so app windows get a tab strip.',
    required: true,
  },
  {
    id: 'enable-desktop-pwas-tab-strip-customizations',
    title: 'Desktop PWA tab strip customizations',
    why: 'Lets Appify set the pinned home tab and the new tab button page.',
    required: true,
  },
  {
    id: 'enable-desktop-pwas-tab-strip-settings',
    title: 'Desktop PWA tab strips settings',
    why: "Adds Chrome's own per-app switch for tabbed mode.",
    required: false,
  },
];

export function flagUrl(id: string): string {
  return `chrome://flags/#${id}`;
}

export async function openFlag(id: string): Promise<void> {
  await chrome.tabs.create({ url: flagUrl(id) });
}

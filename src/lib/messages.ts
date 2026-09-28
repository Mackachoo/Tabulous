// Messages sent from the content script to the service worker.

export type AppifyMessage =
  /** The page's CSP refused Appify's data: manifest. */
  | { type: 'csp-blocked' }
  /** The page is running inside an installed app window. */
  | { type: 'display-mode'; mode: string; wantsTabbed: boolean };

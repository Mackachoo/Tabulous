// Messages sent from the content script to the service worker.

export type TabulousMessage =
  /** The page's CSP refused Tabulous's data: manifest. */
  | { type: 'csp-blocked' }
  /** The page is running inside an installed app window. */
  | { type: 'display-mode'; mode: string; wantsTabbed: boolean };

// Messages sent from the content script to the service worker.

export type TabulousMessage =
  /** The page's CSP refused Tabulous's data: manifest. */
  | { type: 'csp-blocked' }
  /** The page is running inside an installed app window. */
  | { type: 'display-mode'; mode: string; wantsTabbed: boolean }
  /** Replace the CSS Tabulous inserted in the sending frame: remove `previous`, insert `css`. */
  | { type: 'set-css'; css: string; previous: string };

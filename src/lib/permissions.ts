// Host access is granted one site at a time, never <all_urls>.

/** Chrome match patterns without a port match every port on that host. */
export function originPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function hasSitePermission(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(origin)] });
}

/** Must be called straight from a click handler, before any other await. */
export function requestSitePermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(origin)] });
}

export function removeSitePermission(origin: string): Promise<boolean> {
  return chrome.permissions.remove({ origins: [originPattern(origin)] });
}

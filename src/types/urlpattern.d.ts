// URLPattern ships in Chrome and Node but not yet in TypeScript's DOM lib.
interface URLPatternInit {
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  baseURL?: string;
}

declare class URLPattern {
  constructor(input?: string | URLPatternInit, baseURL?: string);
  test(input?: string | URLPatternInit, baseURL?: string): boolean;
}

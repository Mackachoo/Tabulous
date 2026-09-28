import type { SiteConfig } from '../lib/web-manifest';
import { messengerPreset } from './messenger';

/** Starting values for well-known sites, keyed by origin. */
const PRESETS: Record<string, Partial<SiteConfig>> = {
  'https://www.messenger.com': messengerPreset,
  'https://messenger.com': messengerPreset,
};

export function presetFor(origin: string): Partial<SiteConfig> | undefined {
  return PRESETS[origin];
}

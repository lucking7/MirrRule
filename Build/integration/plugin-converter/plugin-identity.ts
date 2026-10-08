import { createHash } from 'node:crypto';

import type { PluginInfo, PluginSourceIdentity } from './types';

export function canonicalPluginSourceUrl(url: string): string {
  const canonicalUrl = new URL(url);
  canonicalUrl.hash = '';
  return canonicalUrl.toString();
}

/** Identify a plugin independently of its display name. */
export function identifyPluginSource(plugin: PluginInfo): PluginSourceIdentity {
  const sourceUrl = canonicalPluginSourceUrl(plugin.url);

  return {
    sourceUrl,
    sourceId: createHash('sha256').update(sourceUrl).digest('hex'),
  };
}

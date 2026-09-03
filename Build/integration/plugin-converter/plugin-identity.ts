import { createHash } from 'node:crypto';

import type { PluginInfo, PluginSourceIdentity } from './types';

/** Identify a plugin independently of its display name. */
export function identifyPluginSource(plugin: PluginInfo): PluginSourceIdentity {
  const canonicalUrl = new URL(plugin.url);
  canonicalUrl.hash = '';
  const sourceUrl = canonicalUrl.toString();

  return {
    sourceUrl,
    sourceId: createHash('sha256').update(sourceUrl).digest('hex'),
  };
}

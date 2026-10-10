import path from 'node:path';

import { findRetiredSourceRecord, retiredPublicPaths } from '../../lib/artifact-lifecycle';
import { canonicalPluginSourceUrl } from './plugin-identity';
import type { PluginInfo } from './types';

const CONVERTED_MODULE_PREFIX = 'Modules/Converted/';

/** Historical converted filenames of retired plugins, derived from the lifecycle registry. */
export const RETIRED_PLUGIN_ARTIFACTS: readonly string[] = retiredPublicPaths().flatMap(relative => (
  relative.startsWith(CONVERTED_MODULE_PREFIX) && !relative.slice(CONVERTED_MODULE_PREFIX.length).includes('/')
    ? [path.posix.basename(relative)]
    : []
));

/** Retire the designated upstream source, independently of its display name. */
export function getPluginRetirementReason(plugin: Pick<PluginInfo, 'url'>): string | undefined {
  return findRetiredSourceRecord(canonicalPluginSourceUrl(plugin.url))?.reason;
}

/** Match only historical output names belonging to the retired source. */
export function isRetiredPluginArtifact(filename: string): boolean {
  return RETIRED_PLUGIN_ARTIFACTS.includes(filename);
}

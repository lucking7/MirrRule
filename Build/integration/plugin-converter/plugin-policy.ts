import { canonicalPluginSourceUrl } from './plugin-identity';
import type { PluginInfo } from './types';

const RETIRED_TENCENT_SOURCE = 'https://kelee.one/Tool/Loon/Lpx/Tencent_Video_remove_ads.lpx';

export const RETIRED_PLUGIN_ARTIFACTS = [
  '腾讯视频去广告.sgmodule',
  'Tencent_Video_remove_ads.sgmodule',
] as const;

/** Retire the designated upstream source, independently of its display name. */
export function getPluginRetirementReason(plugin: Pick<PluginInfo, 'url'>): string | undefined {
  if (canonicalPluginSourceUrl(plugin.url) === RETIRED_TENCENT_SOURCE) {
    return 'Upstream explicitly no longer maintains Tencent Video ad removal';
  }
  return undefined;
}

/** Match only historical output names belonging to the retired source. */
export function isRetiredPluginArtifact(filename: string): boolean {
  return RETIRED_PLUGIN_ARTIFACTS.some(retired => filename === retired);
}

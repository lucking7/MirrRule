/**
 * 平台矩阵配置 - 可开关的多平台支持
 */

import { SurgeRuleSet } from '../core/output/writing-strategy/surge';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { SingboxSource } from '../core/output/writing-strategy/singbox';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import type { BaseWriteStrategy } from '../core/output/writing-strategy/base';

export type SupportedPlatform = 'surge' | 'clash' | 'singbox' | 'loon';

function isSupportedPlatform(target: string): target is SupportedPlatform {
  return target === 'surge' ||
    target === 'clash' ||
    target === 'singbox' ||
    target === 'loon';
}

export function normalizeTargets(
  rawTargets: string[] | undefined,
  fallback: SupportedPlatform[] = ['surge']
): SupportedPlatform[] {
  if (!rawTargets || rawTargets.length === 0) return fallback;

  const unknownTargets = rawTargets.filter(target => !isSupportedPlatform(target));
  if (unknownTargets.length > 0) {
    throw new Error(`Unknown platform target(s): ${unknownTargets.join(', ')}`);
  }

  return rawTargets as SupportedPlatform[];
}

/** Create one platform writer; output paths come from `resolveRuleOutputTarget`. */
export function createWriter(target: SupportedPlatform): BaseWriteStrategy {
  switch (target) {
    case 'surge':
      return new SurgeRuleSet();
    case 'clash':
      return new ClashClassicRuleSet();
    case 'singbox':
      return new SingboxSource();
    case 'loon':
      return new LoonRuleSet();
    default:
      throw new Error(`Unknown platform target: ${target as string}`);
  }
}

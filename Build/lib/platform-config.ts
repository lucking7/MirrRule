/**
 * 平台矩阵配置 - 可开关的多平台支持
 */

import path from 'node:path';
import { SurgeRuleSet } from '../core/output/writing-strategy/surge';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { SingboxSource } from '../core/output/writing-strategy/singbox';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import { SurgeDomainSet } from '../core/output/writing-strategy/surge-domainset';
import type { BaseWriteStrategy } from '../core/output/writing-strategy/base';
import { PLATFORM_OUTPUT_LAYOUT } from './rule-output-variants';
import type { RuleOutputVariant } from './rule-output-variants';

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

export function createStrategiesForTargets(
  targets: SupportedPlatform[],
  outputBaseDir = 'public'
): BaseWriteStrategy[] {
  const strategies: BaseWriteStrategy[] = [];

  // 使用静态导入避免动态加载问题
  for (const target of targets) {
    const platformDir = PLATFORM_OUTPUT_LAYOUT[target].directory;
    const fullOutputDir = path.join(outputBaseDir, platformDir);

    switch (target) {
      case 'surge':

        strategies.push(new SurgeRuleSet('', fullOutputDir));
        break;
      case 'clash':

        strategies.push(new ClashClassicRuleSet('', fullOutputDir));
        break;
      case 'singbox':

        strategies.push(new SingboxSource('', fullOutputDir));
        break;
      case 'loon':

        strategies.push(new LoonRuleSet('', fullOutputDir));
        break;
      default:
        throw new Error(`Unknown platform target: ${String(target)}`);
    }
  }

  return strategies;
}

/** Create the writer for one variant; its `type` places output under `<PlatformDir>/<variant>/`. */
export function createVariantStrategy(
  target: SupportedPlatform,
  variant: RuleOutputVariant,
  outputBaseDir = 'public'
): BaseWriteStrategy {
  const fullOutputDir = path.join(outputBaseDir, PLATFORM_OUTPUT_LAYOUT[target].directory);
  switch (target) {
    case 'surge':
      return variant === 'domainset'
        ? new SurgeDomainSet(fullOutputDir)
        : new SurgeRuleSet(variant, fullOutputDir);
    case 'clash':
      return new ClashClassicRuleSet(variant, fullOutputDir);
    case 'singbox':
      return new SingboxSource(variant, fullOutputDir);
    case 'loon':
      return new LoonRuleSet(variant, fullOutputDir);
    default:
      throw new Error(`Unknown platform target: ${target as string}`);
  }
}

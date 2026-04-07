/**
 * 平台矩阵配置 - 可开关的多平台支持
 */

import path from 'node:path';
import { SurgeRuleSet } from '../core/output/writing-strategy/surge';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { SingboxSource } from '../core/output/writing-strategy/singbox';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import type { BaseWriteStrategy } from '../core/output/writing-strategy/base';
import { getErrorMessage } from './misc';

export type SupportedPlatform = 'surge' | 'clash' | 'singbox' | 'loon';

export interface PlatformConfig {
  /** 启用的目标平台（默认仅Surge） */
  targets: SupportedPlatform[];
  /** 全局默认策略 */
  globalDefaultPolicy: 'DIRECT' | 'REJECT' | 'PROXY' | null;
  /** 每个平台的输出目录配置 */
  outputDirs: Record<SupportedPlatform, string>;
}

export function isSupportedPlatform(target: string): target is SupportedPlatform {
  return target === 'surge' ||
    target === 'clash' ||
    target === 'singbox' ||
    target === 'loon';
}

export function normalizeTargets(
  rawTargets: string[] | undefined,
  fallback: SupportedPlatform[] = ['surge']
): SupportedPlatform[] {
  const targets = (rawTargets ?? []).filter(isSupportedPlatform);
  return targets.length > 0 ? targets : fallback;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  targets: ['surge'],
  globalDefaultPolicy: null,
  outputDirs: {
    surge: 'List',
    clash: 'Clash',
    singbox: 'sing-box',
    loon: 'Loon',
  },
};

export function createStrategiesForTargets(
  targets: SupportedPlatform[],
  outputBaseDir = 'public'
): BaseWriteStrategy[] {
  const strategies: BaseWriteStrategy[] = [];

  // 使用静态导入避免动态加载问题
  try {
    for (const target of targets) {
      const platformDir = DEFAULT_PLATFORM_CONFIG.outputDirs[target];
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
          console.log(`Unknown platform ${target}, skipping`);
      }
    }
  } catch (error) {
    console.warn(
      'Error creating strategies, falling back to Surge only:',
      getErrorMessage(error)
    );
    // 回退到安全的Surge策略
    const fullOutputDir = path.join(outputBaseDir, DEFAULT_PLATFORM_CONFIG.outputDirs.surge);
    strategies.push(new SurgeRuleSet('', fullOutputDir));
  }

  return strategies;
}

/**
 * 策略组清理配置 - 针对不支持策略的平台
 */
export const PLATFORM_POLICY_SUPPORT: Record<SupportedPlatform, boolean> = {
  surge: true, // 完整策略支持
  clash: false, // 不支持策略组
  singbox: false, // 不支持策略组
  loon: true, // 支持策略组
};

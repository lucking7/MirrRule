/**
 * 平台矩阵配置 - 可开关的多平台支持
 */

import path from 'node:path';
import { SurgeRuleSet } from '../core/output/writing-strategy/surge';
import { ClashClassicRuleSet } from '../core/output/writing-strategy/clash';
import { SingboxSource } from '../core/output/writing-strategy/singbox';
import { LoonRuleSet } from '../core/output/writing-strategy/loon';
import type { BaseWriteStrategy } from '../core/output/writing-strategy/base';

export type SupportedPlatform = 'surge' | 'clash' | 'singbox' | 'loon';

export interface PlatformConfig {
  /** 启用的目标平台（默认仅Surge） */
  targets: SupportedPlatform[];
  /** 全局默认策略 */
  globalDefaultPolicy: 'DIRECT' | 'REJECT' | 'PROXY' | null;
  /** 每个平台的输出目录配置 */
  outputDirs: Record<SupportedPlatform, string>;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  targets: ['surge'], // 默认仅启用Surge，兼容"只服务Surge"场景
  globalDefaultPolicy: null, // 全局默认无策略
  outputDirs: {
    surge: 'List',
    clash: 'Clash',
    singbox: 'sing-box',
    loon: 'Loon',
  },
};

/**
 * 根据配置创建对应平台的writing-strategy实例
 * 取消 IP/NON_IP 分类，所有规则使用统一处理
 */
export function createStrategiesForTargets(
  targets: SupportedPlatform[],
  outputBaseDir = 'public'
): BaseWriteStrategy[] {
  const strategies: BaseWriteStrategy[] = [];

  // 使用静态导入避免动态加载问题
  try {
    for (const target of targets) {
      // 🔧 计算每个平台的完整输出目录
      const platformDir = DEFAULT_PLATFORM_CONFIG.outputDirs[target];
      const fullOutputDir = path.join(outputBaseDir, platformDir);

      switch (target) {
        case 'surge':
          // 🔧 type 设为空字符串，避免创建子目录
          strategies.push(new SurgeRuleSet('', fullOutputDir));
          break;
        case 'clash':
          // 🔧 type 设为空字符串，避免创建子目录
          strategies.push(new ClashClassicRuleSet('', fullOutputDir));
          break;
        case 'singbox':
          // 🔧 type 设为空字符串，避免创建子目录
          strategies.push(new SingboxSource('', fullOutputDir));
          break;
        case 'loon':
          // 🔧 type 设为空字符串，避免创建子目录
          strategies.push(new LoonRuleSet('', fullOutputDir));
          break;
        default:
          console.log(`⚠\uFE0F 未知平台 ${target}，跳过`);
      }
    }
  } catch (error) {
    console.warn(
      '⚠\uFE0F 创建策略时出错，回退到仅Surge:',
      error instanceof Error ? error.message : String(error)
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

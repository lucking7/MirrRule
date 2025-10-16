/**
 * 平台矩阵配置 - 可开关的多平台支持
 */

export type SupportedPlatform = 'surge' | 'clash' | 'singbox' | 'loon' | 'quantumult-x' | 'adguard';

export interface PlatformConfig {
  /** 启用的目标平台（默认仅Surge） */
  targets: SupportedPlatform[],
  /** 全局默认策略 */
  globalDefaultPolicy: 'DIRECT' | 'REJECT' | 'PROXY',
  /** 每个平台的输出目录配置 */
  outputDirs: Record<SupportedPlatform, string>
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  targets: ['surge'], // 默认仅启用Surge，兼容"只服务Surge"场景
  globalDefaultPolicy: null as any, // 全局默认无策略
  outputDirs: {
    surge: 'List',
    clash: 'Clash',
    singbox: 'sing-box',
    loon: 'Loon',
    'quantumult-x': 'QuantumultX',
    adguard: 'AdGuardHome'
  }
};

/**
 * 根据配置创建对应平台的writing-strategy实例
 * 取消 IP/NON_IP 分类，所有规则使用统一处理
 */
export function createStrategiesForTargets(
  targets: SupportedPlatform[],
  outputBaseDir = 'public'
): any[] {
  const strategies: any[] = [];

  // 使用静态导入避免动态加载问题
  try {
    for (const target of targets) {
      switch (target) {
        case 'surge':
          const SurgeModule = require('../core/output/writing-strategy/surge');
          if (SurgeModule?.SurgeRuleSet) {
            strategies.push(new SurgeModule.SurgeRuleSet());
          }
          break;
        case 'clash':
          const ClashModule = require('../core/output/writing-strategy/clash');
          if (ClashModule?.ClashClassicRuleSet) {
            strategies.push(new ClashModule.ClashClassicRuleSet());
          }
          break;
        case 'singbox':
          const SingboxModule = require('../core/output/writing-strategy/singbox');
          if (SingboxModule?.SingboxSource) {
            strategies.push(new SingboxModule.SingboxSource());
          }
          break;
        // 暂时只启用核心平台，避免导入错误
        default:
          console.log(`⚠\uFE0F 平台 ${target} 暂未完全集成，跳过`);
      }
    }
  } catch (error) {
    console.warn('⚠\uFE0F 创建策略时出错，回退到仅Surge:', error instanceof Error ? error.message : String(error));
    // 回退到安全的Surge策略
    const SurgeModule = require('../core/output/writing-strategy/surge');
    if (SurgeModule?.SurgeRuleSet) {
      strategies.push(new SurgeModule.SurgeRuleSet());
    }
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
  'quantumult-x': true, // 支持策略组
  adguard: false // 不支持策略组
};

/**
 * 模块配置文件
 * 声明哪些模块需要特殊处理以及其他配置
 */

export interface ModuleConfig {
  // 需要增强处理的模块列表（ScriptHub 转换后需要额外处理）
  modulesRequiringEnhancement: string[];

  // 需要地址修复的模式
  addressFixPatterns: {
    pattern: RegExp;
    replacement: string;
  }[];
}

export const moduleConfig: ModuleConfig = {
  // 需要增强处理的模块（ScriptHub 转换后需要额外处理）
  modulesRequiringEnhancement: [
    'Remove_ads_by_fmz.sgmodule',
    'blockAds.sgmodule',
    // 可以在这里添加更多需要增强处理的模块
  ],

  // 地址修复模式
  addressFixPatterns: [
    {
      // 修复 127.0.0.1:9101 地址
      pattern: /http:\/\/127\.0\.0\.1:9101\//g,
      replacement: 'http://script.hub/',
    },
    {
      // 修复 127.0.0.1:9100 地址
      pattern: /http:\/\/127\.0\.0\.1:9100\//g,
      replacement: 'http://script.hub/',
    },
  ],
};

/**
 * 检查模块是否需要增强处理
 */
export function needsParameterFix(moduleName: string): boolean {
  return moduleConfig.modulesRequiringEnhancement.includes(moduleName);
}

/**
 * 获取模块的 Loon 插件 URL
 * 这个函数可以根据模块名返回对应的 Loon 插件 URL
 */
export function getLoonPluginUrl(moduleName: string): string | null {
  // 这里可以维护一个映射表，或者从其他地方读取
  const mapping: { [key: string]: string } = {
    'Remove_ads_by_fmz.sgmodule':
      'https://github.com/fmz200/wool_scripts/raw/main/Loon/plugin/blockAds.plugin',
    'blockAds.sgmodule':
      'https://github.com/fmz200/wool_scripts/raw/main/Loon/plugin/blockAds.plugin',
    // 添加更多映射
  };

  return mapping[moduleName] || null;
}

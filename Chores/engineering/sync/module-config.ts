/**
 * 模块配置文件
 * 声明哪些模块需要进行参数修正以及其他配置
 */

export interface ModuleConfig {
  // 需要参数修正的模块列表
  modulesRequiringParameterFix: string[];

  // 需要地址修复的模式
  addressFixPatterns: {
    pattern: RegExp;
    replacement: string;
  }[];
}

export const moduleConfig: ModuleConfig = {
  // 需要参数修正的模块
  modulesRequiringParameterFix: [
    'Remove_ads_by_fmz.sgmodule',
    'blockAds.sgmodule',
    // 可以在这里添加更多需要参数修正的模块
  ],

  // 地址修复模式
  addressFixPatterns: [
    {
      pattern: /http:\/\/127\.0\.0\.1:9101\/convert\//g,
      replacement: 'http://script.hub/convert/',
    },
    {
      pattern: /http:\/\/127\.0\.0\.1:9100\/convert\//g,
      replacement: 'http://script.hub/convert/',
    },
  ],
};

/**
 * 检查模块是否需要参数修正
 */
export function needsParameterFix(moduleName: string): boolean {
  return moduleConfig.modulesRequiringParameterFix.includes(moduleName);
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

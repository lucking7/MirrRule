/**
 * QuantumultX Rewrite 转换配置
 * 定义需要转换的 QX rewrite 文件列表
 */

import path from 'node:path';
import type { QXConversionConfig } from './index';

/**
 * 输出目录
 * 所有转换的模块直接输出到 Modules 根目录
 */
const OUTPUT_DIR = path.join(__dirname, '../../../public/Modules');

/**
 * QX Rewrite 转换配置列表
 */
export const QX_CONVERSION_CONFIGS: QXConversionConfig[] = [
  {
    sourceUrl: 'https://github.com/fmz200/wool_scripts/raw/main/QuantumultX/rewrite/weibo.snippet',
    outputFileName: 'weibo.sgmodule',
    moduleName: '微博去广告',
    moduleDescription: '从 QuantumultX rewrite 转换而来',
    outputDir: OUTPUT_DIR,
  },
  // 可以在这里添加更多 QX rewrite 转换配置
];

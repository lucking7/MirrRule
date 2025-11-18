/**
 * QuantumultX Rewrite 转换配置
 * 定义需要转换的 QX rewrite 文件列表
 */

import path from 'node:path';
import type { QXConversionConfig } from './index';

/**
 * 输出目录
 * 所有转换的模块直接输出到 Modules 根目录
 *
 * 当前暂未在运行时代码中引用，仅作为配置示意，
 * 因此使用下划线前缀避免 ESLint 未使用变量告警。
 */
const _OUTPUT_DIR = path.join(__dirname, '../../../public/Modules');

/**
 * QX Rewrite 转换配置列表
 */
export const QX_CONVERSION_CONFIGS: QXConversionConfig[] = [
  // 可以在这里添加更多 QX rewrite 转换配置
];

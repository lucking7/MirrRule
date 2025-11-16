import path from 'node:path';
import process from 'node:process';

// CommonJS 中的 __dirname 直接可用
// const __dirname = __dirname; // 不需要重新定义

export const ROOT_DIR = path.resolve(__dirname, '../..');

export const CACHE_DIR = path.resolve(ROOT_DIR, '.cache');

export const SOURCE_DIR = path.join(ROOT_DIR, 'Source');

export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(ROOT_DIR, 'public');

// Surge 输出目录改为 public/List/
export const OUTPUT_SURGE_DIR = path.join(PUBLIC_DIR, 'List');
export const OUTPUT_CLASH_DIR = path.resolve(PUBLIC_DIR, 'Clash');
export const OUTPUT_SINGBOX_DIR = path.resolve(PUBLIC_DIR, 'sing-box');
export const OUTPUT_LOON_DIR = path.resolve(PUBLIC_DIR, 'Loon');
export const OUTPUT_QUANTUMULT_X_DIR = path.resolve(PUBLIC_DIR, 'QuantumultX');
export const OUTPUT_INTERNAL_DIR = path.resolve(PUBLIC_DIR, 'Internal');

// Sukka 镜像目录 - 统一放在 Mirror/Sukka 下
export const OUTPUT_SUKKA_MIRROR_DIR = path.resolve(PUBLIC_DIR, 'Mirror', 'Sukka');
export const OUTPUT_MOCK_DIR = path.resolve(OUTPUT_SUKKA_MIRROR_DIR, 'mock');
export const OUTPUT_MODULES_DIR = path.resolve(OUTPUT_SUKKA_MIRROR_DIR, 'sgmodule');
export const OUTPUT_MODULES_RULES_DIR = path.resolve(OUTPUT_MODULES_DIR, 'Rules');

// 遗留导出（兼容性）- 如果这些目录不再使用，应该删除引用
export const OUTPUT_SURFBOARD_DIR = path.resolve(PUBLIC_DIR, 'Surfboard');
export const OUTPUT_LEAGCY_CLASH_PREMIUM_DIR = path.resolve(PUBLIC_DIR, 'Clash', 'Premium');

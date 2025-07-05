import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 在ES模块中获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '../../../..');

export const CACHE_DIR = path.resolve(ROOT_DIR, '.cache');

// 源文件目录
export const SOURCE_DIR = path.join(ROOT_DIR, 'Source');
export const SURGE_DIR = path.join(ROOT_DIR, 'Surge');
export const DIAL_DIR = path.join(ROOT_DIR, 'Dial');

// 检测是否在CI环境中运行
export const IS_CI = process.env.CI === 'true';

// 使用RAM磁盘如果在CI环境中
// 输出目录
export const PUBLIC_DIR = IS_CI
  ? process.env.RAM_DIR || '/dev/shm/esdeath'
  : process.env.OUTPUT_DIR || path.resolve(ROOT_DIR, 'public');

// 输出子目录
export const OUTPUT_SURGE_DIR = path.join(PUBLIC_DIR, 'Surge');
export const OUTPUT_RULESETS_DIR = path.join(PUBLIC_DIR, 'List');
export const OUTPUT_MODULES_DIR = path.join(PUBLIC_DIR, 'Modules');
export const OUTPUT_SCRIPTS_DIR = path.join(PUBLIC_DIR, 'Scripts');
export const OUTPUT_DIAL_DIR = path.join(PUBLIC_DIR, 'Dial');
export const OUTPUT_DOMAINSET_DIR = path.join(PUBLIC_DIR, 'Domain');
export const OUTPUT_INTERNAL_DIR = path.resolve(PUBLIC_DIR, 'Internal');

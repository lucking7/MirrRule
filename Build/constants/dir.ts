import path from 'node:path';
import process from 'node:process';

export const ROOT_DIR = path.resolve(__dirname, '../..');

export const CACHE_DIR = path.resolve(ROOT_DIR, '.cache');

export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(ROOT_DIR, 'public');

// Sukka 镜像目录 - 统一放在 Mirror/Sukka 下
export const OUTPUT_SUKKA_MIRROR_DIR = path.resolve(PUBLIC_DIR, 'Mirror', 'Sukka');
export const OUTPUT_MOCK_DIR = path.resolve(OUTPUT_SUKKA_MIRROR_DIR, 'mock');
export const OUTPUT_MODULES_DIR = path.resolve(OUTPUT_SUKKA_MIRROR_DIR, 'sgmodule');

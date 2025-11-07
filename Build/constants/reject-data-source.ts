/**
 * 拒绝数据源常量
 * 最小化版本，仅包含必要的调试常量
 */

/**
 * 调试域名查找
 * 用于在处理过程中查找特定域名
 */
import process from 'node:process';

export const DEBUG_DOMAIN_TO_FIND: string | null = process.env.DEBUG_DOMAIN || null;

/**
 * 默认拒绝数据源列表
 * 空数组，避免依赖问题
 */
export const REJECT_DATA_SOURCES: string[] = [];

/**
 * 白名单域名
 * 空数组，避免依赖问题
 */
export const WHITELIST_DOMAINS: string[] = [];

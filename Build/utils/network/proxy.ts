/**
 * 代理工具模块
 * 为需要代理访问的 URL 提供统一的代理支持
 */

import process from 'node:process';

/**
 * 默认代理基础 URL
 */
const DEFAULT_PROXY_BASE = 'https://proxy-one.cc.sbs?url=';

/**
 * 需要代理的域名列表
 */
const PROXY_REQUIRED_DOMAINS = ['kelee.one'] as const;

/**
 * 检查 URL 是否需要使用代理
 * 目前匹配 kelee.one 域名（含子域名）
 */
export function shouldUseProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return PROXY_REQUIRED_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * 为 URL 添加代理前缀（如果需要）
 * 默认使用 https://proxy-one.cc.sbs?url=，也支持通过 PROXY_BASE 环境变量覆盖
 */
export function applyProxyIfNeeded(url: string): string {
  if (!shouldUseProxy(url)) {
    return url;
  }

  const proxyBase = process.env.PROXY_BASE || DEFAULT_PROXY_BASE;
  return proxyBase + url;
}

/**
 * 获取当前代理基础 URL
 */
export function getProxyBase(): string {
  return process.env.PROXY_BASE || DEFAULT_PROXY_BASE;
}

/**
 * 返回按优先级排列的 URL 备选列表，优先使用代理，其次直连
 */
export function buildProxyUrlCandidates(url: string): string[] {
  const proxied = applyProxyIfNeeded(url);

  if (proxied === url) {
    return [url];
  }

  return [proxied, url];
}

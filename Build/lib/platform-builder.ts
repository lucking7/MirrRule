/**
 * 平台定制化构建器
 * 根据不同的部署目标执行特定的构建优化
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// 平台配置类型
interface PlatformConfig {
  name: string,
  description: string,
  env: Record<string, string>,
  features: Record<string, boolean>,
  optimizations: Record<string, boolean>
}

// 构建目标类型
type BuildTarget = 'github-pages' | 'cloudflare-pages' | 'nrrule-repo' | 'default';

/**
 * 获取当前构建目标
 */
export function getBuildTarget(): BuildTarget {
  const target = process.env.BUILD_TARGET as BuildTarget;
  return target || 'default';
}

/**
 * 加载平台配置
 */
export async function loadPlatformConfig(target: BuildTarget): Promise<PlatformConfig | null> {
  try {
    const configPath = path.join(process.cwd(), '.github/workflows/build-config.json');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    return config.platforms[target] || null;
  } catch (error) {
    console.warn(`⚠\uFE0F Failed to load platform config for ${target}:`, error);
    return null;
  }
}

/**
 * GitHub Pages 特定构建
 */
export async function buildForGitHubPages(publicDir: string): Promise<void> {
  console.log('🏗\uFE0F Building for GitHub Pages...');

  // 生成 Jekyll 配置
  if (process.env.ENABLE_JEKYLL === 'true') {
    await generateJekyllConfig(publicDir);
  }

  // 生成 Sitemap
  await generateSitemap(publicDir);

  // 生成 robots.txt
  await generateRobotsTxt(publicDir);

  // 压缩静态资源
  if (process.env.ENABLE_COMPRESSION === 'true') {
    await compressStaticAssets(publicDir);
  }

  console.log('✅ GitHub Pages build completed');
}

/**
 * Cloudflare Pages 特定构建
 */
export async function buildForCloudflarePages(publicDir: string): Promise<void> {
  console.log('🏗\uFE0F Building for Cloudflare Pages...');

  // Edge 优化
  if (process.env.ENABLE_EDGE_OPTIMIZATION === 'true') {
    await optimizeForEdge(publicDir);
  }

  // 生成 _headers 文件（Cloudflare 特定）
  await generateCloudflareHeaders(publicDir);

  // 生成 _redirects 文件
  await generateCloudflareRedirects(publicDir);

  // Brotli 压缩
  await applyBrotliCompression(publicDir);

  console.log('✅ Cloudflare Pages build completed');
}

/**
 * NRRule Repository 特定构建
 */
export async function buildForNRRuleRepo(publicDir: string): Promise<void> {
  console.log('🏗\uFE0F Building for NRRule Repository...');

  // 文件去重
  if (process.env.ENABLE_COMPRESSION === 'true') {
    await deduplicateFiles(publicDir);
  }

  // 格式规范化
  await normalizeFileFormats(publicDir);

  // 生成元数据
  await generateMetadata(publicDir);

  // CDN 优化
  if (process.env.OPTIMIZE_FOR_CDN === 'true') {
    await optimizeForCDN(publicDir);
  }

  console.log('✅ NRRule Repository build completed');
}

/**
 * 主构建函数
 */
export async function buildForPlatform(publicDir: string): Promise<void> {
  const target = getBuildTarget();
  console.log(`🎯 Build target: ${target}`);

  // 加载平台配置
  const config = await loadPlatformConfig(target);
  if (config) {
    console.log(`📋 Platform: ${config.name}`);
    console.log(`📝 Description: ${config.description}`);
  }

  // 根据目标执行特定构建
  switch (target) {
    case 'github-pages':
      await buildForGitHubPages(publicDir);
      break;

    case 'cloudflare-pages':
      await buildForCloudflarePages(publicDir);
      break;

    case 'nrrule-repo':
      await buildForNRRuleRepo(publicDir);
      break;

    default:
      console.log('ℹ\uFE0F Using default build configuration');
      break;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成 Jekyll 配置文件
 */
async function generateJekyllConfig(publicDir: string): Promise<void> {
  console.log('  📄 Generating Jekyll config...');
  const configContent = `---
permalink: pretty
exclude: ['.meta', '*.md', 'node_modules']
plugins:
  - jekyll-sitemap
  - jekyll-seo-tag
`;
  await fs.writeFile(path.join(publicDir, '_config.yml'), configContent);
}

/**
 * 生成 Sitemap
 */
async function generateSitemap(publicDir: string): Promise<void> {
  console.log('  🗺\uFE0F Generating sitemap...');
  // 实现 sitemap 生成逻辑
  // 这里是示例，实际需要遍历所有文件
  const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
  await fs.writeFile(path.join(publicDir, 'sitemap.xml'), sitemapContent);
}

/**
 * 生成 robots.txt
 */
async function generateRobotsTxt(publicDir: string): Promise<void> {
  console.log('  🤖 Generating robots.txt...');
  const robotsContent = `User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
`;
  await fs.writeFile(path.join(publicDir, 'robots.txt'), robotsContent);
}

/**
 * 压缩静态资源
 */
async function compressStaticAssets(publicDir: string): Promise<void> {
  console.log('  🗜\uFE0F Compressing static assets...');
  // 实现压缩逻辑（gzip, minify 等）
}

/**
 * Edge 优化
 */
async function optimizeForEdge(publicDir: string): Promise<void> {
  console.log('  ⚡ Optimizing for Edge...');
  // 实现 Edge 优化逻辑
}

/**
 * 生成 Cloudflare Headers
 */
async function generateCloudflareHeaders(publicDir: string): Promise<void> {
  console.log('  📋 Generating Cloudflare headers...');
  const headersContent = `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cache-Control: public, max-age=3600

/List/*
  Cache-Control: public, max-age=86400
  
/Modules/*
  Cache-Control: public, max-age=86400
`;
  await fs.writeFile(path.join(publicDir, '_headers'), headersContent);
}

/**
 * 生成 Cloudflare Redirects
 */
async function generateCloudflareRedirects(publicDir: string): Promise<void> {
  console.log('  🔀 Generating Cloudflare redirects...');
  const redirectsContent = `# Redirects
/old-path/* /new-path/:splat 301
`;
  await fs.writeFile(path.join(publicDir, '_redirects'), redirectsContent);
}

/**
 * Brotli 压缩
 */
async function applyBrotliCompression(publicDir: string): Promise<void> {
  console.log('  🗜\uFE0F Applying Brotli compression...');
  // 实现 Brotli 压缩逻辑
}

/**
 * 文件去重
 */
async function deduplicateFiles(publicDir: string): Promise<void> {
  console.log('  🔍 Deduplicating files...');
  // 实现文件去重逻辑
}

/**
 * 格式规范化
 */
async function normalizeFileFormats(publicDir: string): Promise<void> {
  console.log('  📐 Normalizing file formats...');
  // 实现格式规范化逻辑
}

/**
 * 生成元数据
 */
async function generateMetadata(publicDir: string): Promise<void> {
  console.log('  📊 Generating metadata...');
  const metadata = {
    buildTime: new Date().toISOString(),
    buildTarget: getBuildTarget(),
    version: process.env.npm_package_version || 'unknown',
    files: {
      total: 0,
      byType: {}
    }
  };

  await fs.writeFile(
    path.join(publicDir, '.meta', 'build-info.json'),
    JSON.stringify(metadata, null, 2)
  );
}

/**
 * CDN 优化
 */
async function optimizeForCDN(publicDir: string): Promise<void> {
  console.log('  🌐 Optimizing for CDN...');
  // 实现 CDN 优化逻辑
  // - 添加合适的 Cache-Control headers
  // - 优化文件命名（添加 hash）
  // - 生成 CDN 友好的目录结构
}

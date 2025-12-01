/**
 * GEOIP MMDB 文件下载模块
 *
 * 职责：
 * - 下载 GEOIP MMDB 二进制数据库文件
 * - 不做任何修改或转换,直接保存原始文件
 */

import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import picocolors from 'picocolors';
import { task } from './trace';
import { $$fetch } from './utils/network/fetch-retry';
import { mkdirp } from './lib/misc';

/**
 * GEOIP 文件配置
 */
export interface GEOIPFile {
  /** 输出路径(相对于 public 目录),例如: 'GEOIP/geoip2-cn.mmdb' */
  path: string,
  /** 下载 URL */
  url: string,
  /** 可选描述 */
  description?: string
}

/**
 * GEOIP MMDB 文件配置列表
 * 这些文件是二进制数据库文件,不需要规则转换处理
 * 直接下载到 public/GEOIP/ 目录
 */
export const geoipFiles: GEOIPFile[] = [
  {
    path: 'GEOIP/geoip2-cn.mmdb',
    url: 'https://github.com/Hackl0us/GeoIP2-CN/raw/release/Country.mmdb',
    description: 'GEOIP2 中国 IP 数据库 (Hackl0us)'
  },
  {
    path: 'GEOIP/chnroutes2.mmdb',
    url: 'https://raw.githubusercontent.com/soffchen/GeoIP2-CN/release/Country.mmdb',
    description: 'GEOIP2 中国路由数据库 (soffchen)'
  },
  {
    path: 'GEOIP/ipinfo.mmdb',
    url: 'https://github.com/lucking7/ASN-China/raw/main/ipinfo.lite.mmdb',
    description: 'IPInfo 国家数据库 (lite)'
  },
  {
    path: 'GEOIP/ip2.mmdb',
    url: 'https://github.com/xream/geoip/releases/latest/download/ip2location.country.mmdb',
    description: 'IP2Location 国家数据库'
  }
];

/**
 * 下载 GEOIP MMDB 文件
 */
export const downloadGEOIP = task(
  require.main === module,
  __filename
)(async span => {
  // 使用本模块的配置
  const files = geoipFiles;

  const stats = {
    success: 0,
    failed: 0,
    total: files.length
  };

  console.log(picocolors.cyan(`\n🌍 开始下载 ${stats.total} 个 GEOIP MMDB 文件...\n`));

  for (const file of files) {
    await span.traceChildAsync(`download: ${file.path}`, async () => {
      try {
        const outputPath = path.join('public', file.path);
        const outputDir = path.dirname(outputPath);

        // 确保输出目录存在
        const p = mkdirp(outputDir);
        if (p) await p;

        console.log(picocolors.gray(`  📥 下载: ${file.path}`));
        console.log(picocolors.gray(`     URL: ${file.url}`));

        // 下载二进制文件
        const res = await $$fetch(file.url);

        if (!res.body) {
          throw new Error('响应体为空');
        }

        // 直接写入文件,不做任何处理
        await pipeline(res.body, fs.createWriteStream(outputPath));

        const fileSize = fs.statSync(outputPath).size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

        console.log(picocolors.green(`  ✅ ${file.path} (${fileSizeMB} MB)\n`));
        stats.success++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(picocolors.red(`  ❌ ${file.path}: ${errorMessage}\n`));
        stats.failed++;
      }
    });
  }

  console.log(picocolors.cyan('\n📊 GEOIP 下载统计:'));
  console.log(picocolors.green(`  ✅ 成功: ${stats.success}`));
  if (stats.failed > 0) {
    console.log(picocolors.red(`  ❌ 失败: ${stats.failed}`));
  }
  console.log(picocolors.gray(`  📦 总计: ${stats.total}\n`));

  return stats;
});

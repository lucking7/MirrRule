import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import picocolors from 'picocolors';
import { task } from './trace';
import { $$fetch } from './utils/network/fetch-retry';
import { mkdirp } from './lib/misc';
import { getErrorMessage } from './utils/cli/logger';

export interface GEOIPFile {
  path: string;
  url: string;
}

export const geoipFiles: GEOIPFile[] = [
  {
    path: 'GeoIP/geoip2-cn.mmdb',
    url: 'https://github.com/Hackl0us/GeoIP2-CN/raw/release/Country.mmdb',
  },
  {
    path: 'GeoIP/chnroutes2.mmdb',
    url: 'https://raw.githubusercontent.com/soffchen/GeoIP2-CN/release/Country.mmdb',
  },
  {
    path: 'GeoIP/ipinfo.mmdb',
    url: 'https://github.com/lucking7/ASN-China/raw/main/ipinfo.lite.mmdb',
  },
  {
    path: 'GeoIP/ip2.mmdb',
    url: 'https://github.com/xream/geoip/releases/latest/download/ip2location.country.mmdb',
  },
];

export const downloadGEOIP = task(
  require.main === module,
  __filename
)(async span => {
  const files = geoipFiles;
  const stats = { success: 0, failed: 0, total: files.length };

  console.log(picocolors.cyan(`\nDownloading ${stats.total} GEOIP MMDB files...\n`));

  for (const file of files) {
    await span.traceChildAsync(`download: ${file.path}`, async () => {
      try {
        const outputPath = path.join('public', file.path);
        const outputDir = path.dirname(outputPath);

        const p = mkdirp(outputDir);
        if (p) await p;

        console.log(picocolors.gray(`  Downloading: ${file.path}`));
        console.log(picocolors.gray(`     URL: ${file.url}`));

        const res = await $$fetch(file.url);
        if (!res.body) {
          throw new Error('Empty response body');
        }

        await pipeline(res.body, fs.createWriteStream(outputPath));

        const fileSize = fs.statSync(outputPath).size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

        console.log(picocolors.green(`  [OK] ${file.path} (${fileSizeMB} MB)\n`));
        stats.success++;
      } catch (error) {
        console.error(picocolors.red(`  [FAIL] ${file.path}: ${getErrorMessage(error)}\n`));
        stats.failed++;
      }
    });
  }

  console.log(picocolors.cyan('\nGEOIP Download Summary:'));
  console.log(picocolors.green(`  Success: ${stats.success}`));
  if (stats.failed > 0) {
    console.log(picocolors.red(`  Failed: ${stats.failed}`));
  }
  console.log(picocolors.gray(`  Total: ${stats.total}\n`));

  return stats;
});

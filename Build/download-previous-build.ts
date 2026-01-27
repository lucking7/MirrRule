import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import undici from 'undici';
import picocolors from 'picocolors';

import { task } from './trace';
import { PUBLIC_DIR } from './constants/dir';
import { isDirectoryEmptySync } from './lib/misc';
import type { Headers as TarEntryHeaders } from 'tar-fs';
import { extract as tarExtract } from 'tar-fs';
import { isCI } from 'ci-info';
import { headStatus } from './lib/tarball-utils.ts';

const GITHUB_CODELOAD_URL = 'https://codeload.github.com/lucking7/NRRule/tar.gz/master';
const GITLAB_CODELOAD_URL =
  'https://gitlab.com/lucking7/NRRule/-/archive/master/NRRule-master.tar.gz';

export const downloadPreviousBuild = task(
  require.main === module,
  __filename
)(async span => {
  if (fs.existsSync(PUBLIC_DIR) && !isDirectoryEmptySync(PUBLIC_DIR)) {
    console.log(picocolors.blue('Public directory exists, skip downloading previous build'));
    return;
  }

  // 在 CI 中我们期望使用 actions/checkout 预热构建产物，若目录为空则直接抛错
  if (isCI) {
    throw new Error('CI environment detected, but public directory is empty');
  }

  const tarGzUrl = await span.traceChildAsync('get tar.gz url', async () => {
    const statusCode = await headStatus(GITHUB_CODELOAD_URL);
    if (statusCode !== 200) {
      console.warn('Download previous build from GitHub failed! Status:', statusCode);
      console.warn('Switch to GitLab');
      return GITLAB_CODELOAD_URL;
    }
    return GITHUB_CODELOAD_URL;
  });

  return span.traceChildAsync('download & extract previous build', () => {
    const respBody = undici
      .pipeline(
        tarGzUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'curl/8.12.1',
            // 规避部分服务对 UA/Fetch-Mode 的限制
            'sec-fetch-mode': 'same-origin',
          },
        },
        ({ statusCode, body }) => {
          if (statusCode !== 200) {
            console.warn('Download previous build failed! Status:', statusCode);
            if (statusCode === 404) {
              throw new Error('Download previous build failed! 404');
            }
          }
          return body;
        }
      )
      .end();

    const pathPrefix = 'ruleset.skk.moe-master/';

    return pipeline(
      respBody,
      zlib.createGunzip(),
      tarExtract(PUBLIC_DIR, {
        ignore(_: string, header?: TarEntryHeaders) {
          if (header) {
            if (header.type !== 'file' && header.type !== 'directory') {
              return true;
            }
            if (header.type === 'file' && path.extname(header.name) === '.ts') {
              return true;
            }
          }
          return false;
        },
        map(header) {
          header.name = header.name.replace(pathPrefix, '');
          return header;
        },
      })
    );
  });
});

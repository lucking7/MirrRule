import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import picocolors from 'picocolors';

import { task } from './trace';
import { PUBLIC_DIR } from './constants/dir';
import { isDirectoryEmptySync } from './lib/misc';
import type { Headers as TarEntryHeaders } from 'tar-fs';
import { extract as tarExtract } from 'tar-fs';
import { isCI } from 'ci-info';
import { chooseTarballUrl, getTarballBody } from './lib/tarball-utils.ts';

const GITHUB_CODELOAD_URL = 'https://codeload.github.com/lucking7/NRRule/tar.gz/main';
const GITLAB_CODELOAD_URL =
  'https://gitlab.com/lucking7/NRRule/-/archive/main/NRRule-main.tar.gz';

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

  const tarGzUrl = await span.traceChildAsync('get tar.gz url', () =>
    chooseTarballUrl(GITHUB_CODELOAD_URL, GITLAB_CODELOAD_URL, statusCode => {
      console.warn('Download previous build from GitHub failed! Status:', statusCode);
      console.warn('Switch to GitLab');
    })
  );

  return span.traceChildAsync('download & extract previous build', () => {
    const respBody = getTarballBody(tarGzUrl, 'curl/8.12.1', statusCode => {
      console.warn('Download previous build failed! Status:', statusCode);
      if (statusCode === 404) {
        throw new Error('Download previous build failed! 404');
      }
    });

    const pathPrefix = 'NRRule-main/';

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

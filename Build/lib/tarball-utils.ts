import { requestWithLog } from '../utils/network/fetch-retry.ts';
import undici from 'undici';

async function headStatus(url: string): Promise<number> {
  const resp = await requestWithLog(url, { method: 'HEAD' });
  return resp.statusCode;
}

export async function chooseTarballUrl(
  githubUrl: string,
  gitlabUrl: string,
  onFallback: (statusCode: number) => void
): Promise<string> {
  const statusCode = await headStatus(githubUrl);
  if (statusCode !== 200) {
    onFallback(statusCode);
    return gitlabUrl;
  }
  return githubUrl;
}

export function getTarballBody(
  url: string,
  userAgent: string,
  onNonSuccess: (statusCode: number) => void
) {
  return undici
    .pipeline(
      url,
      {
        method: 'GET',
        headers: {
          // 规避部分服务对 UA/Fetch-Mode 的限制。
          'User-Agent': userAgent,
          'sec-fetch-mode': 'same-origin',
        },
      },
      ({ statusCode, body }) => {
        if (statusCode !== 200) onNonSuccess(statusCode);
        return body;
      }
    )
    .end();
}

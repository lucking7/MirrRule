import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic-file';
import { listTreeFiles } from './publication-manifest';
import { retiredPublicPaths } from './artifact-lifecycle';

const INTERNAL_PREFIX = '/Internal/';

async function internalPaths(publicDir: string): Promise<string[]> {
  const directory = path.join(publicDir, 'Internal');
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory()) throw new Error(`Internal inventory is not a regular directory: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return (await listTreeFiles(directory)).map(relative => INTERNAL_PREFIX + relative);
}

/** Gate Internal inventory and registered retired URLs before the static asset cache. */
export async function writePagesInternalGate(publicDir: string): Promise<void> {
  const paths = await internalPaths(publicDir);
  const retired = [...new Set(retiredPublicPaths().map(relative => `/${relative}`))].sort();
  const include = [INTERNAL_PREFIX + '*', ...retired.map(relative => relative.split('/').map(segment => encodeURIComponent(segment)).join('/'))];
  if (include.length > 100) throw new Error(`Pages gate requires ${include.length} routes; the limit is 100`);
  const worker = String.raw`const prefix = ${JSON.stringify(INTERNAL_PREFIX)};
const active = new Set(${JSON.stringify(paths)});
const retired = new Set(${JSON.stringify(retired)});
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { decoded = null; }
    if (!pathname.startsWith(prefix) && !retired.has(decoded)) return env.ASSETS.fetch(request);
    if (!retired.has(decoded) && active.has(decoded)) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
      response.headers.set('x-robots-tag', 'noindex');
      response.headers.set('x-content-type-options', 'nosniff');
      return response;
    }
    return new Response(request.method === 'HEAD' ? null : 'Not Found\n', {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex'
      }
    });
  }
};
`;
  await writeFileAtomic(path.join(publicDir, '_worker.js'), worker);
  await writeFileAtomic(path.join(publicDir, '_routes.json'), `${JSON.stringify({ version: 1, include, exclude: [] }, null, 2)}\n`);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic-file';
import { listTreeFiles } from './publication-manifest';
import { retiredPublicPaths, retiredPublicPrefixes } from './artifact-lifecycle';
import { PLATFORM_OUTPUT_LAYOUT, RULE_OUTPUT_VARIANTS } from './rule-output-variants';

const INTERNAL_PREFIX = '/Internal/';
/**
 * Variant files come and go with upstream content (an ip variant with no-resolve choices, a
 * sing-box non_ip when a ruleset turns IP-only), and mirrored modules are renamed or dropped
 * upstream (fmz200 names each file after its #!name). The edge cache keeps serving a deleted
 * file, so the worker serves only the files of this tree below these prefixes and answers
 * 404 for the rest.
 */
const GATED_PREFIXES = [
  ...Object.values(PLATFORM_OUTPUT_LAYOUT).flatMap(layout => RULE_OUTPUT_VARIANTS.map(variant => `/${layout.directory}/${variant}/`)),
  '/Mirror/',
].sort();

function encodePublicPath(relative: string): string {
  return relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/** Files below `<publicDir><prefix>` as public paths; a missing directory has none. */
async function treePaths(publicDir: string, prefix: string): Promise<string[]> {
  const directory = path.join(publicDir, ...prefix.split('/').filter(Boolean));
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory()) throw new Error(`Gated directory is not a regular directory: ${directory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return (await listTreeFiles(directory)).map(relative => prefix + relative);
}

/**
 * Gate Internal inventory, split variants, mirrors, and registered retired URLs and directories before
 * the static asset cache.
 */
export async function writePagesInternalGate(publicDir: string): Promise<void> {
  const paths = await treePaths(publicDir, INTERNAL_PREFIX);
  const published = (await Promise.all(GATED_PREFIXES.map(prefix => treePaths(publicDir, prefix)))).flat();
  const retired = [...new Set(retiredPublicPaths().map(relative => `/${relative}`))].sort();
  const retiredPrefixes = [...new Set(retiredPublicPrefixes().map(relative => `/${relative}`))].sort();
  // Exact retired paths inside a routed directory need no route of their own.
  const routedPrefixes = [...GATED_PREFIXES, ...retiredPrefixes];
  const include = [
    INTERNAL_PREFIX + '*',
    ...routedPrefixes.map(prefix => encodePublicPath(prefix) + '*'),
    ...retired.flatMap(relative => (routedPrefixes.some(prefix => relative.startsWith(prefix)) ? [] : [encodePublicPath(relative)])),
  ];
  if (include.length > 100) throw new Error(`Pages gate requires ${include.length} routes; the limit is 100`);
  const worker = String.raw`const prefix = ${JSON.stringify(INTERNAL_PREFIX)};
const active = new Set(${JSON.stringify(paths)});
const gatedPrefixes = ${JSON.stringify(GATED_PREFIXES)};
const published = new Set(${JSON.stringify(published)});
const retired = new Set(${JSON.stringify(retired)});
const retiredPrefixes = ${JSON.stringify(retiredPrefixes)};
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { decoded = null; }
    const isRetired = retired.has(decoded) || (decoded !== null && retiredPrefixes.some(retiredPrefix => decoded.startsWith(retiredPrefix)));
    const isGated = gatedPrefixes.some(gatedPrefix => pathname.startsWith(gatedPrefix));
    if (!pathname.startsWith(prefix) && !isGated && !isRetired) return env.ASSETS.fetch(request);
    if (!isRetired && isGated && published.has(decoded)) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      // _headers rules do not apply to worker responses; repeat the ruleset directory headers, which
      // build-public also applies to Mirror.
      response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
      response.headers.set('content-type', 'text/plain; charset=utf-8');
      response.headers.set('x-robots-tag', 'noindex');
      return response;
    }
    if (!isRetired && active.has(decoded)) {
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

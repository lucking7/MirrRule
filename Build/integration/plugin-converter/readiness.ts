import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadMergeConfig } from '../../lib/module-merger/config-loader';
import { mergeModules, selectModuleSources } from '../../lib/module-merger';
import { resolveLocalModuleCandidates } from '../../lib/module-merger/module-loader';
import type { ConversionResult } from './types';

interface ExistingCandidate {
  path: string;
  content: string;
}

async function firstExistingCandidate(
  candidates: string[],
): Promise<ExistingCandidate | undefined> {
  for (const candidate of candidates) {
    try {
      return {
        path: candidate,
        content: await fs.readFile(candidate, 'utf8'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

/** convert-plugins exits with this when upstream is down; the workflow keeps the accepted modules. */
export const UPSTREAM_UNAVAILABLE_EXIT_CODE = 3;

export class PluginCatalogUnavailableError extends Error {
  override name = 'PluginCatalogUnavailableError';
}

/** True when every plugin that is not ready failed to download, so the converter itself is not at fault. */
export function isUpstreamOutage(results: readonly ConversionResult[]): boolean {
  const failed = results.filter(result => result.status !== 'ready');
  return failed.length > 0 && failed.every(result => /download failed/i.test(result.error ?? ''));
}

export async function verifyRequiredPluginOutputs(
  results: ConversionResult[],
  configPath: string,
): Promise<number> {
  const { config, baseDir } = await loadMergeConfig(configPath);
  const selected = selectModuleSources(config.modules, {});
  if (!selected.length) throw new Error('Required plugin selection is empty');

  await Promise.all(
    selected.map(async (source) => {
      if (
        source.url.startsWith('http://') ||
        source.url.startsWith('https://')
      ) {
        throw new Error(`Required module ${source.header} uses a remote source`);
      }

      const candidates = resolveLocalModuleCandidates(source.url, [
        baseDir,
        process.cwd(),
      ]);
      const actual = await firstExistingCandidate(candidates);
      if (!actual) {
        throw new Error(`Required plugin output is missing: ${source.header}`);
      }
      if (!actual.content.trim()) {
        throw new Error(`Required plugin output is empty: ${source.header}`);
      }

      const normalizedPath = path.resolve(actual.path);
      const matching = results.filter(
        (result) =>
          result.outputPath && path.resolve(result.outputPath) === normalizedPath,
      );
      if (
        !matching.length ||
        matching.some((result) => result.status !== 'ready')
      ) {
        throw new Error(`Required plugin output is not ready: ${source.header}`);
      }
    }),
  );

  await mergeModules(configPath, { dryRun: true });
  return selected.length;
}

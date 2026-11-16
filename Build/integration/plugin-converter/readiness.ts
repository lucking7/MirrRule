import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadMergeConfig } from '../../lib/module-merger/config-loader';
import { mergeModules, selectModuleSources } from '../../lib/module-merger';
import { resolveLocalModuleCandidates } from '../../lib/module-merger/module-loader';
import { getErrorMessage } from '../../lib/misc';
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

/**
 * A required module is missing or not ready. `upstreamUnavailable` is true only when every such
 * module failed because its plugin or a required script could not be downloaded (network error or
 * HTTP 5xx); convert-plugins then exits with UPSTREAM_UNAVAILABLE_EXIT_CODE instead of 1.
 */
export class RequiredPluginOutputError extends Error {
  override name = 'RequiredPluginOutputError';
  readonly upstreamUnavailable: boolean;

  constructor(message: string, options: ErrorOptions & { upstreamUnavailable: boolean }) {
    super(message, options);
    this.upstreamUnavailable = options.upstreamUnavailable;
  }
}

export async function verifyRequiredPluginOutputs(
  results: ConversionResult[],
  configPath: string,
): Promise<number> {
  const { config, baseDir } = await loadMergeConfig(configPath);
  const selected = selectModuleSources(config.modules, {});
  if (!selected.length) throw new Error('Required plugin selection is empty');

  // `unmatched`: no current result names this output. A plugin that failed before conversion has
  // no output path, so such modules can only be matched to download failures by count.
  const checks = await Promise.all(
    selected.map(async (source): Promise<{ problem: string, cause: 'upstream' | 'unmatched' | 'other' } | undefined> => {
      if (
        source.url.startsWith('http://') ||
        source.url.startsWith('https://')
      ) {
        return { problem: `Required module ${source.header} uses a remote source`, cause: 'other' };
      }

      const candidates = resolveLocalModuleCandidates(source.url, [
        baseDir,
        process.cwd(),
      ]).map(candidate => path.resolve(candidate));
      const actual = await firstExistingCandidate(candidates);
      if (actual && !actual.content.trim()) {
        return { problem: `Required plugin output is empty: ${source.header}`, cause: 'other' };
      }

      const expectedPaths = actual ? [path.resolve(actual.path)] : candidates;
      const matching = results.filter(
        (result) =>
          result.outputPath && expectedPaths.includes(path.resolve(result.outputPath)),
      );
      const notReady = matching.filter((result) => result.status !== 'ready');
      if (actual && matching.length && !notReady.length) return undefined;

      if (!matching.length) {
        return {
          problem: actual
            ? `Required plugin output is not ready: ${source.header} (no current conversion result)`
            : `Required plugin output is missing: ${source.header}`,
          cause: 'unmatched',
        };
      }
      if (!notReady.length) {
        return { problem: `Required plugin output is missing: ${source.header} (current result is ready)`, cause: 'other' };
      }
      return {
        problem: `Required plugin output is not ready: ${source.header} (${notReady.map((result) => result.error ?? result.status).join('; ')})`,
        cause: notReady.every((result) => result.upstreamUnavailable) ? 'upstream' : 'other',
      };
    }),
  );

  const problems = checks.filter((check) => check !== undefined);
  if (problems.length) {
    const unmatched = problems.filter((check) => check.cause === 'unmatched').length;
    const withoutOutput = results.filter((result) => result.status !== 'ready' && !result.outputPath);
    const upstreamUnavailable = problems.every((check) => check.cause !== 'other') && (
      unmatched === 0
      || (withoutOutput.length >= unmatched && withoutOutput.every((result) => result.upstreamUnavailable))
    );
    throw new RequiredPluginOutputError(problems.map((check) => check.problem).sort().join('; '), { upstreamUnavailable });
  }

  try {
    await mergeModules(configPath, { dryRun: true });
  } catch (error) {
    throw new RequiredPluginOutputError(`Merge dry-run failed: ${getErrorMessage(error)}`, {
      upstreamUnavailable: false,
      cause: error,
    });
  }
  return selected.length;
}

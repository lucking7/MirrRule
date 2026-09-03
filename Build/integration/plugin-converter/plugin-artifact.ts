import fs from 'node:fs/promises';

import { writeFileAtomic } from '../../lib/atomic-file';
import { getErrorMessage } from '../../lib/misc';
import { applyScriptMirrorMap } from './script-extractor';
import type { ConversionResult } from './types';

export interface PendingPluginArtifact {
  result: Omit<ConversionResult, 'status'>,
  content: string
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function publishPluginArtifacts(
  pending: PendingPluginArtifact[],
  urlMap: Readonly<Record<string, string>>,
  degradedUrls: ReadonlySet<string> = new Set()
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = [];

  for (const artifact of pending) {
    const unresolved = artifact.result.scripts.filter(
      script => !script.isMirrored && !urlMap[script.originalUrl]
    );
    if (unresolved.length > 0) {
      const status = await fileExists(artifact.result.outputPath) ? 'degraded' : 'failed';
      results.push({
        ...artifact.result,
        success: false,
        status,
        error: `${unresolved.length} required script${unresolved.length === 1 ? '' : 's'} unavailable`,
      });
      continue;
    }

    if (!artifact.result.outputPath) {
      results.push({
        ...artifact.result,
        success: false,
        status: 'failed',
        error: 'Converted plugin has no output path',
      });
      continue;
    }

    try {
      await writeFileAtomic(
        artifact.result.outputPath,
        applyScriptMirrorMap(artifact.content, artifact.result.scripts, urlMap)
      );
      const degradedDependencies = artifact.result.scripts.filter(
        script => degradedUrls.has(script.originalUrl)
      );
      if (degradedDependencies.length > 0) {
        results.push({
          ...artifact.result,
          success: false,
          status: 'degraded',
          error: `${degradedDependencies.length} script${degradedDependencies.length === 1 ? '' : 's'} using cached artifacts`,
        });
      } else {
        results.push({ ...artifact.result, success: true, status: 'ready' });
      }
    } catch (error) {
      const status = await fileExists(artifact.result.outputPath) ? 'degraded' : 'failed';
      results.push({
        ...artifact.result,
        success: false,
        status,
        error: getErrorMessage(error),
      });
    }
  }

  return results;
}

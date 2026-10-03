import fs from 'node:fs/promises';
import path from 'node:path';

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
  const rendered = pending.map(artifact => applyScriptMirrorMap(
    artifact.content,
    artifact.result.scripts,
    urlMap
  ));
  const artifactsByPath = new Map<string, number[]>();

  for (const [index, artifact] of pending.entries()) {
    if (!artifact.result.outputPath) continue;
    const outputPath = path.resolve(artifact.result.outputPath);
    const indexes = artifactsByPath.get(outputPath) ?? [];
    indexes.push(index);
    artifactsByPath.set(outputPath, indexes);
  }

  const conflictingPaths = new Set<string>();
  for (const [outputPath, indexes] of artifactsByPath) {
    if (new Set(indexes.map(index => rendered[index])).size > 1) {
      conflictingPaths.add(outputPath);
    }
  }

  for (const [index, artifact] of pending.entries()) {
    if (artifact.result.outputPath && conflictingPaths.has(path.resolve(artifact.result.outputPath))) {
      results.push({
        ...artifact.result,
        status: 'failed',
        error: `Conflicting converted plugins target ${path.basename(artifact.result.outputPath)}`,
      });
      continue;
    }

    const unresolved = artifact.result.scripts.filter(
      script => !urlMap[script.originalUrl]
    );
    if (unresolved.length > 0) {
      const status = await fileExists(artifact.result.outputPath) ? 'degraded' : 'failed';
      results.push({
        ...artifact.result,
        status,
        error: `${unresolved.length} required script${unresolved.length === 1 ? '' : 's'} unavailable`,
      });
      continue;
    }

    if (!artifact.result.outputPath) {
      results.push({
        ...artifact.result,
        status: 'failed',
        error: 'Converted plugin has no output path',
      });
      continue;
    }

    try {
      await writeFileAtomic(
        artifact.result.outputPath,
        rendered[index]
      );
      const degradedDependencies = artifact.result.scripts.filter(
        script => degradedUrls.has(script.originalUrl)
      );
      if (degradedDependencies.length > 0) {
        results.push({
          ...artifact.result,
          status: 'degraded',
          error: `${degradedDependencies.length} script${degradedDependencies.length === 1 ? '' : 's'} using cached artifacts`,
        });
      } else {
        results.push({ ...artifact.result, status: 'ready' });
      }
    } catch (error) {
      const status = await fileExists(artifact.result.outputPath) ? 'degraded' : 'failed';
      results.push({
        ...artifact.result,
        status,
        error: getErrorMessage(error),
      });
    }
  }

  return results;
}

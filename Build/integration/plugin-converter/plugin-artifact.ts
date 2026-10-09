import fs from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from '../../lib/atomic-file';
import { getErrorMessage } from '../../lib/misc';
import { applyScriptMirrorMap } from './script-extractor';
import { isRetiredPluginArtifact } from './plugin-policy';
import type { ConversionResult } from './types';

export interface PendingPluginArtifact {
  result: Omit<ConversionResult, 'status'>,
  content: string
}

export type PluginPublicationWork = PendingPluginArtifact | ConversionResult;

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
  work: PluginPublicationWork[],
  urlMap: Readonly<Record<string, string>>,
  degradedUrls: ReadonlySet<string> = new Set()
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = [];
  const rendered = new Map<PendingPluginArtifact, string>();
  const contentsByPath = new Map<string, Set<string>>();

  for (const item of work) {
    if (!('content' in item)) continue;
    const content = applyScriptMirrorMap(item.content, item.result.scripts, urlMap);
    rendered.set(item, content);
    if (!item.result.outputPath) continue;
    const outputPath = path.resolve(item.result.outputPath);
    const contents = contentsByPath.get(outputPath) ?? new Set<string>();
    contents.add(content);
    contentsByPath.set(outputPath, contents);
  }

  const conflictingPaths = new Set<string>();
  for (const [outputPath, contents] of contentsByPath) {
    if (contents.size > 1) conflictingPaths.add(outputPath);
  }

  for (const artifact of work) {
    if (!('content' in artifact)) {
      results.push(artifact);
      continue;
    }
    if (artifact.result.outputPath && isRetiredPluginArtifact(path.basename(artifact.result.outputPath))) {
      results.push({
        ...artifact.result,
        status: 'failed',
        error: 'Converted plugin targets a retired subscription filename; choose a different module name',
      });
      continue;
    }
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
        rendered.get(artifact)!
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

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import picocolors from 'picocolors';
import { writeFileAtomic } from '../../lib/atomic-file';

interface PluginMetadata {
  version: 1;
  listCount?: number;
  scripts: Record<string, string>
}

export interface MetadataObservation {
  listCount?: number;
  scripts?: Record<string, string>
}

const DEFAULT_PLUGIN_METADATA_PATH = path.join(
  process.cwd(),
  '.cache',
  'plugin-provenance.json'
);

function emptyMetadata(): PluginMetadata {
  return { version: 1, scripts: {} };
}

async function readMetadata(metadataPath: string): Promise<PluginMetadata> {
  try {
    const parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Partial<PluginMetadata>;
    if (parsed.version !== 1 || typeof parsed.scripts !== 'object' || parsed.scripts === null) {
      return emptyMetadata();
    }
    return { version: 1, listCount: parsed.listCount, scripts: parsed.scripts };
  } catch {
    return emptyMetadata();
  }
}

async function emitWarnings(warnings: string[], summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  for (const warning of warnings) {
    console.warn(picocolors.yellow(`⚠️ [Plugin provenance] ${warning}`));
  }
  if (warnings.length > 0 && summaryPath) {
    const lines = warnings.map(warning => `- ⚠️ ${warning}`).join('\n');
    try {
      await fs.appendFile(summaryPath, `\n### Plugin provenance warnings\n${lines}\n`);
    } catch (error) {
      console.warn(picocolors.yellow(`⚠️ [Plugin provenance] Could not update step summary: ${String(error)}`));
    }
  }
}

/** Atomically merge observations and return non-blocking change warnings. */
export async function updatePluginMetadata(
  observation: MetadataObservation,
  metadataPath = DEFAULT_PLUGIN_METADATA_PATH,
  summaryPath = process.env.GITHUB_STEP_SUMMARY
): Promise<string[]> {
  const previous = await readMetadata(metadataPath);
  const warnings: string[] = [];

  if (observation.listCount !== undefined && previous.listCount !== undefined) {
    const shrink = (previous.listCount - observation.listCount) / previous.listCount;
    if (shrink > 0.3) {
      warnings.push(`plugin list shrank from ${previous.listCount} to ${observation.listCount} entries (${Math.round(shrink * 100)}%)`);
    }
  }

  for (const [url, digest] of Object.entries(observation.scripts ?? {})) {
    const oldDigest = previous.scripts[url];
    if (oldDigest !== undefined && oldDigest !== digest) {
      warnings.push(`script SHA-256 changed: ${url}`);
    }
  }

  const next: PluginMetadata = {
    version: 1,
    listCount: observation.listCount ?? previous.listCount,
    scripts: { ...previous.scripts, ...observation.scripts },
  };
  await writeFileAtomic(metadataPath, `${JSON.stringify(next, null, 2)}\n`);
  await emitWarnings(warnings, summaryPath);
  return warnings;
}

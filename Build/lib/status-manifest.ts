import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { SupportedPlatform } from './platform-config';

export interface BuildStatusManifest {
  buildTime: string;
  commit: string | null;
  rulesets: Array<{
    id: string;
    platforms: SupportedPlatform[];
    ruleCount: number;
    lastSuccess: string;
  }>;
  mirrors: Array<{
    id: string;
    status: 'included' | 'not-run';
  }>;
}

export interface BuildStatusInput {
  buildTime: string;
  commit: string | null;
  rulesets: Array<{ id: string; platforms: SupportedPlatform[]; ruleCount: number }>;
  mirrors: Array<{ id: string; status: 'included' | 'not-run' }>;
}

const PLATFORM_ORDER: SupportedPlatform[] = ['surge', 'clash', 'singbox', 'loon'];

export function normalizeCommit(value: string | undefined): string | null {
  const commit = value?.trim();
  return commit && /^[\da-f]{7,40}$/i.test(commit) ? commit : null;
}

export function buildStatusManifest(input: BuildStatusInput): BuildStatusManifest {
  return {
    buildTime: input.buildTime,
    commit: input.commit,
    rulesets: input.rulesets
      .map(ruleset => ({
        id: ruleset.id,
        platforms: [...new Set(ruleset.platforms)].sort(
          (a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b)
        ),
        ruleCount: ruleset.ruleCount,
        lastSuccess: input.buildTime,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    mirrors: input.mirrors
      .map(mirror => ({ id: mirror.id, status: mirror.status }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export async function writeStatusManifestAtomic(
  outputPath: string,
  manifest: BuildStatusManifest
): Promise<void> {
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}

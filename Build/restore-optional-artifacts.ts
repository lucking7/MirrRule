import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadMergeConfig } from './lib/module-merger/config-loader';
import { selectModuleSources } from './lib/module-merger';
import { resolveLocalModuleCandidates } from './lib/module-merger/module-loader';
import { writeFileAtomic } from './lib/atomic-file';
import { extractScriptUrls, validateScriptPreservation } from './integration/plugin-converter/script-extractor';
import { validateScriptContent } from './integration/plugin-converter/script-mirror';
import { findRetiredExclusiveScripts, isRetiredPublicPath, normalizePublicPath } from './lib/artifact-lifecycle';

/** Provenance of files copied from a previous accepted tree, relative to the publication root. */
export const PRESERVED_ARTIFACTS_PATH = 'Internal/preserved-artifacts.json';
const PRESERVED_ARTIFACTS_SCHEMA_VERSION = 1;
const COMMIT_PATTERN = /^[\da-f]{7,64}$/i;

export interface PreservedArtifactFile {
  path: string,
  sha256: string,
  bytes: number
}

export interface PreservedArtifacts {
  schemaVersion: 1,
  fromCommit: string | null,
  files: PreservedArtifactFile[]
}

export interface RestoreOptions {
  /** Commit of the previous tree the optional artifacts are copied from. */
  fromCommit?: string
}

function parsePreservedArtifacts(value: unknown, source: string): PreservedArtifacts {
  const data = value as Partial<PreservedArtifacts> | null;
  if (!data || typeof data !== 'object' || data.schemaVersion !== PRESERVED_ARTIFACTS_SCHEMA_VERSION || !Array.isArray(data.files)) {
    throw new Error(`Unsupported preserved artifact provenance: ${source}`);
  }
  if (data.fromCommit !== null && (typeof data.fromCommit !== 'string' || !COMMIT_PATTERN.test(data.fromCommit))) {
    throw new Error(`Invalid preserved artifact commit in ${source}`);
  }
  const files = data.files.map((entry: Partial<PreservedArtifactFile>) => {
    if (
      typeof entry.path !== 'string'
      || typeof entry.sha256 !== 'string' || !/^[\da-f]{64}$/.test(entry.sha256)
      || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
    ) {
      throw new Error(`Invalid preserved artifact entry in ${source}`);
    }
    const normalized = normalizePublicPath(entry.path);
    if (normalized !== entry.path) throw new Error(`Preserved artifact path is not normalized: ${entry.path}`);
    return { path: normalized, sha256: entry.sha256, bytes: entry.bytes };
  });
  return { schemaVersion: PRESERVED_ARTIFACTS_SCHEMA_VERSION, fromCommit: data.fromCommit, files };
}

/** Read `Internal/preserved-artifacts.json`; returns null when no file was preserved by restoration. */
export async function readPreservedArtifacts(publicRoot: string): Promise<PreservedArtifacts | null> {
  const file = path.join(publicRoot, ...PRESERVED_ARTIFACTS_PATH.split('/'));
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parsePreservedArtifacts(JSON.parse(raw), file);
}

async function writePreservedArtifacts(
  publicRoot: string,
  existing: PreservedArtifacts | null,
  fromCommit: string | null,
  restored: readonly PreservedArtifactFile[],
): Promise<void> {
  const byPath = new Map<string, PreservedArtifactFile>();
  for (const entry of [...(existing?.files ?? []), ...restored]) byPath.set(entry.path, entry);
  const manifest: PreservedArtifacts = {
    schemaVersion: PRESERVED_ARTIFACTS_SCHEMA_VERSION,
    fromCommit: fromCommit ?? existing?.fromCommit ?? null,
    files: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0))),
  };
  await writeFileAtomic(
    path.join(publicRoot, ...PRESERVED_ARTIFACTS_PATH.split('/')),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function provenance(relative: string, content: string | Uint8Array): PreservedArtifactFile {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path: normalizePublicPath(relative),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.byteLength,
  };
}

/** Parse `<merge-config> <previous-root> [--from-commit <sha>]`, accepting the flag anywhere. */
export function parseRestoreArgs(argv: readonly string[]): { configPath: string, previousRoot: string, fromCommit?: string } {
  const positional: string[] = [];
  let fromCommit: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--from-commit') {
      fromCommit = argv[++index];
      if (!fromCommit) throw new Error('--from-commit requires a commit');
    } else if (arg.startsWith('--from-commit=')) {
      fromCommit = arg.slice('--from-commit='.length);
    } else {
      positional.push(arg);
    }
  }
  const [configPath, previousRoot] = positional;
  if (!configPath || !previousRoot || positional.length > 2) {
    throw new Error(
      'Usage: restore-optional-artifacts.ts <merge-config> <previous-root> [--from-commit <sha>]',
    );
  }
  if (fromCommit !== undefined && !COMMIT_PATTERN.test(fromCommit)) throw new Error(`Invalid --from-commit: ${fromCommit}`);
  return { configPath, previousRoot, ...(fromCommit !== undefined && { fromCommit }) };
}

function publicRelative(root: string, file: string, prefix: string): string {
  return [prefix, ...path.relative(root, file).split(path.sep)].join('/');
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(file);
      return entry.isFile() ? [file] : [];
    }),
  );
  return nested.flat();
}

/** Preserve previous optional subscriptions only after all required fresh inputs have passed merging. */
export async function restorePreviousOptionalArtifacts(
  configPath: string,
  previousRoot: string,
  publicRoot = path.resolve('public'),
  options: RestoreOptions = {},
): Promise<{ modules: number; scripts: number }> {
  if (options.fromCommit !== undefined && !COMMIT_PATTERN.test(options.fromCommit)) {
    throw new Error(`Invalid fromCommit: ${options.fromCommit}`);
  }
  const existingProvenance = await readPreservedArtifacts(publicRoot);
  if (options.fromCommit && existingProvenance?.fromCommit && existingProvenance.fromCommit !== options.fromCommit) {
    throw new Error(`Preserved artifacts already recorded from ${existingProvenance.fromCommit}; refusing to mix ${options.fromCommit}`);
  }
  const { config, baseDir } = await loadMergeConfig(configPath);
  const selected = selectModuleSources(config.modules, {});
  if (!selected.length) throw new Error('Required module selection is empty');
  const convertedRoot = path.join(publicRoot, 'Modules', 'Converted');
  const scriptsRoot = path.join(publicRoot, 'Scripts');
  const required = new Set<string>();
  for (const module of selected) {
    const candidates = resolveLocalModuleCandidates(module.url, [
      baseDir,
      process.cwd(),
    ]);
    const candidate = candidates.find(
      (file) => path.dirname(file) === convertedRoot,
    );
    if (
      !candidate ||
      !(await exists(candidate)) ||
      !(await fs.readFile(candidate)).length
    ) {
      throw new Error(
        `Required current output is missing; refusing restoration: ${module.header}`,
      );
    }
    required.add(candidate);
  }

  const restored: PreservedArtifactFile[] = [];
  let scripts = 0;
  const previousScripts = path.join(previousRoot, 'Scripts');
  const retiredExclusiveScripts = new Set(await findRetiredExclusiveScripts(previousRoot));
  for (const file of await filesUnder(previousScripts)) {
    if (!file.endsWith('.js')) continue;
    const relativeScript = publicRelative(previousScripts, file, 'Scripts');
    if (isRetiredPublicPath(relativeScript) || retiredExclusiveScripts.has(relativeScript)) {
      console.warn(`Skipped retired previous script: ${path.basename(file)}`);
      continue;
    }
    const destination = path.join(
      scriptsRoot,
      path.relative(previousScripts, file),
    );
    if (await exists(destination)) continue;
    const content = await fs.readFile(file);
    if (!validateScriptContent(content)) {
      console.warn(`Skipped invalid previous script: ${path.basename(file)}`);
      continue;
    }
    await writeFileAtomic(destination, content);
    restored.push(provenance(relativeScript, content));
    scripts++;
  }

  let modules = 0;
  const previousConverted = path.join(previousRoot, 'Modules', 'Converted');
  for (const file of await filesUnder(previousConverted)) {
    if (!file.endsWith('.sgmodule')) continue;
    const relativeModule = publicRelative(previousConverted, file, 'Modules/Converted');
    if (isRetiredPublicPath(relativeModule)) {
      console.warn(`Skipped retired previous module: ${path.basename(file)}`);
      continue;
    }
    const destination = path.join(
      convertedRoot,
      path.relative(previousConverted, file),
    );
    if (required.has(destination) || (await exists(destination))) continue;
    const content = await fs.readFile(file, 'utf8');
    if (validateScriptPreservation('', content)) {
      console.warn(
        `Skipped invalid previous optional module: ${path.basename(file)}`,
      );
      continue;
    }
    let validDependencies = true;
    for (const script of extractScriptUrls(content).filter(
      (item) => item.isMirrored,
    )) {
      let relative: string;
      try {
        relative = decodeURIComponent(
          new URL(script.originalUrl).pathname.slice('/Scripts/'.length),
        );
      } catch {
        console.warn(
          `Skipped previous optional module with invalid script URL: ${path.basename(file)}`,
        );
        validDependencies = false;
        break;
      }
      const target = path.resolve(scriptsRoot, relative);
      if (
        !target.startsWith(`${scriptsRoot}${path.sep}`) ||
        !(await exists(target)) ||
        !validateScriptContent(await fs.readFile(target))
      ) {
        console.warn(
          `Skipped previous optional module with missing or invalid script: ${path.basename(file)}`,
        );
        validDependencies = false;
        break;
      }
    }
    if (!validDependencies) continue;
    await writeFileAtomic(destination, content);
    restored.push(provenance(relativeModule, content));
    modules++;
  }
  await writePreservedArtifacts(publicRoot, existingProvenance, options.fromCommit ?? null, restored);
  return { modules, scripts };
}

if (require.main === module) {
  const { configPath, previousRoot, fromCommit } = parseRestoreArgs(process.argv.slice(2));
  restorePreviousOptionalArtifacts(configPath, previousRoot, undefined, { fromCommit })
    .then((result) => {
      console.log(
        `Preserved previous optional artifacts: modules=${result.modules}, scripts=${result.scripts}; not fresh conversion results`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

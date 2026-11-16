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
  fromCommit?: string,
  /** `PLUGIN_CONVERSION_REPORT` of the current conversion run. */
  conversionReport: string
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

const USAGE = 'Usage: restore-optional-artifacts.ts <merge-config> <previous-root> --conversion-report <path> [--from-commit <sha>]';

/** Parse the CLI arguments, accepting the flags anywhere. */
export function parseRestoreArgs(argv: readonly string[]): { configPath: string, previousRoot: string, conversionReport: string, fromCommit?: string } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const flag = ['--from-commit', '--conversion-report'].find(name => arg === name || arg.startsWith(`${name}=`));
    if (!flag) {
      positional.push(arg);
      continue;
    }
    const value = arg === flag ? argv[++index] : arg.slice(flag.length + 1);
    if (!value) throw new Error(`${flag} requires ${flag === '--from-commit' ? 'a commit' : 'a path'}`);
    flags.set(flag, value);
  }
  const [configPath, previousRoot] = positional;
  const conversionReport = flags.get('--conversion-report');
  if (!configPath || !previousRoot || !conversionReport || positional.length > 2) throw new Error(USAGE);
  const fromCommit = flags.get('--from-commit');
  if (fromCommit !== undefined && !COMMIT_PATTERN.test(fromCommit)) throw new Error(`Invalid --from-commit: ${fromCommit}`);
  return { configPath, previousRoot, conversionReport, ...(fromCommit !== undefined && { fromCommit }) };
}

/**
 * Decide which converted modules missing from this run may be restored. A previous module is kept
 * only while the current run explains its absence: its plugin failed this run, or a plugin failed
 * before conversion, when the output name is unknown. A module that no current plugin produces,
 * because the plugin was removed from the catalog or renamed, is dropped.
 */
export async function readConversionReport(file: string): Promise<(relativeModule: string) => boolean> {
  const report = JSON.parse(await fs.readFile(file, 'utf8')) as { schemaVersion?: unknown, results?: unknown };
  if (report.schemaVersion !== 1 || !Array.isArray(report.results)) throw new Error(`Unsupported plugin conversion report: ${file}`);
  const claimed = new Set<string>();
  const notReady = new Set<string>();
  let unnamedFailures = 0;
  for (const entry of report.results as Array<{ file?: unknown, status?: unknown }>) {
    if (typeof entry.file === 'string') {
      claimed.add(entry.file);
      if (entry.status !== 'ready') notReady.add(entry.file);
    } else if (entry.status !== 'ready') {
      unnamedFailures++;
    }
  }
  return relativeModule => notReady.has(relativeModule) || (!claimed.has(relativeModule) && unnamedFailures > 0);
}

/** Path below Scripts/ of a mirrored script URL, or undefined when it cannot be decoded or escapes the directory. */
function mirroredScriptPath(url: string): string | undefined {
  let relative: string;
  try {
    relative = decodeURIComponent(new URL(url).pathname.slice('/Scripts/'.length));
  } catch {
    return undefined;
  }
  const normalized = path.posix.normalize(relative);
  return normalized && normalized !== '.' && !normalized.startsWith('../') && !path.posix.isAbsolute(normalized) ? normalized : undefined;
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
  publicRoot: string,
  options: RestoreOptions,
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
  const previousScripts = path.join(previousRoot, 'Scripts');
  const retiredExclusiveScripts = new Set(await findRetiredExclusiveScripts(previousRoot));
  const explainsMissingModule = await readConversionReport(options.conversionReport);

  /** Current or previous copy of a mirrored script, if valid; the current copy wins. */
  async function availableScript(relative: string): Promise<boolean> {
    for (const root of [scriptsRoot, previousScripts]) {
      const target = path.resolve(root, ...relative.split('/'));
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
      // eslint-disable-next-line no-await-in-loop -- the current copy is checked before the previous one
      if (await exists(target)) return validateScriptContent(await fs.readFile(target));
    }
    return false;
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
    if (!explainsMissingModule(path.relative(previousConverted, file).split(path.sep).join('/'))) {
      console.warn(`Dropped previous optional module that no current plugin produces: ${path.basename(file)}`);
      continue;
    }
    const content = await fs.readFile(file, 'utf8');
    if (validateScriptPreservation('', content)) {
      console.warn(
        `Skipped invalid previous optional module: ${path.basename(file)}`,
      );
      continue;
    }
    let validDependencies = true;
    for (const script of extractScriptUrls(content).filter(item => item.isMirrored)) {
      const relative = mirroredScriptPath(script.originalUrl);
      // eslint-disable-next-line no-await-in-loop -- stops at the first missing dependency
      if (relative === undefined || !(await availableScript(relative))) {
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

  // Restore only the scripts that a module of this tree loads; an unreferenced script is dropped.
  const referenced = new Set<string>();
  for (const file of await filesUnder(path.join(publicRoot, 'Modules'))) {
    if (!file.endsWith('.sgmodule')) continue;
    for (const script of extractScriptUrls(await fs.readFile(file, 'utf8'))) {
      const relative = script.isMirrored ? mirroredScriptPath(script.originalUrl) : undefined;
      if (relative !== undefined) referenced.add(relative);
    }
  }
  let scripts = 0;
  for (const relative of [...referenced].sort()) {
    const relativeScript = `Scripts/${relative}`;
    if (isRetiredPublicPath(relativeScript) || retiredExclusiveScripts.has(relativeScript)) {
      console.warn(`Skipped retired previous script: ${path.basename(relative)}`);
      continue;
    }
    const destination = path.resolve(scriptsRoot, ...relative.split('/'));
    const source = path.resolve(previousScripts, ...relative.split('/'));
    if (!source.startsWith(`${path.resolve(previousScripts)}${path.sep}`)) continue;
    if (await exists(destination) || !(await exists(source))) continue;
    const content = await fs.readFile(source);
    if (!validateScriptContent(content)) {
      console.warn(`Skipped invalid previous script: ${path.basename(relative)}`);
      continue;
    }
    await writeFileAtomic(destination, content);
    restored.push(provenance(relativeScript, content));
    scripts++;
  }
  await writePreservedArtifacts(publicRoot, existingProvenance, options.fromCommit ?? null, restored);
  return { modules, scripts };
}

if (require.main === module) {
  const { configPath, previousRoot, conversionReport, fromCommit } = parseRestoreArgs(process.argv.slice(2));
  restorePreviousOptionalArtifacts(configPath, previousRoot, path.resolve('public'), { conversionReport, ...(fromCommit !== undefined && { fromCommit }) })
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

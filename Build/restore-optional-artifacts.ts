import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadMergeConfig } from './lib/module-merger/config-loader';
import { selectModuleSources } from './lib/module-merger';
import { resolveLocalModuleCandidates } from './lib/module-merger/module-loader';
import { writeFileAtomic } from './lib/atomic-file';
import { extractScriptUrls } from './integration/plugin-converter/script-extractor';
import { validateScriptContent } from './integration/plugin-converter/script-mirror';

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
): Promise<{ modules: number; scripts: number }> {
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

  let scripts = 0;
  const previousScripts = path.join(previousRoot, 'Scripts');
  for (const file of await filesUnder(previousScripts)) {
    if (!file.endsWith('.js')) continue;
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
    scripts++;
  }

  let modules = 0;
  const previousConverted = path.join(previousRoot, 'Modules', 'Converted');
  for (const file of await filesUnder(previousConverted)) {
    if (!file.endsWith('.sgmodule')) continue;
    const destination = path.join(
      convertedRoot,
      path.relative(previousConverted, file),
    );
    if (required.has(destination) || (await exists(destination))) continue;
    const content = await fs.readFile(file, 'utf8');
    if (!content.trim() || !/^\s*\[[^\]]+]/m.test(content)) {
      console.warn(
        `Skipped invalid previous optional module: ${path.basename(file)}`,
      );
      continue;
    }
    let validDependencies = true;
    for (const script of extractScriptUrls(content).filter(
      (item) => item.isMirrored,
    )) {
      const relative = decodeURIComponent(
        new URL(script.originalUrl).pathname.slice('/Scripts/'.length),
      );
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
    modules++;
  }
  return { modules, scripts };
}

if (require.main === module) {
  const [configPath, previousRoot] = process.argv.slice(2);
  if (!configPath || !previousRoot) {
 throw new Error(
      'Usage: restore-optional-artifacts.ts <merge-config> <previous-root>',
    );
}
  restorePreviousOptionalArtifacts(configPath, previousRoot)
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

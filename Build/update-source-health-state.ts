import fs from 'node:fs/promises';
import process from 'node:process';
import { reconcileSourceHealth, validatePersistedSourceHealthState } from './lib/source-health-state';
import { createSourceInventory } from './lib/source-inventory';
import type { SourceInventoryEntry } from './lib/source-inventory';
import { ruleGroups, specialRules } from './lib/rule-sources';
import { MIRROR_GROUPS } from './integration/mirror-sync/mirror-config';
import { writeFileAtomic } from './lib/atomic-file';

async function readState(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { sources: {} };
    }
    throw error;
  }
}

export async function updateSourceHealthState(
  reportPath: string,
  statePath: string,
  actionsPath: string,
  inventory: readonly SourceInventoryEntry[]
): Promise<void> {
  const report: unknown = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const previous = await readState(statePath);
  validatePersistedSourceHealthState(previous);
  const { state, actions } = reconcileSourceHealth(previous, report, inventory);
  await writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await writeFileAtomic(actionsPath, `${JSON.stringify(actions, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [reportPath, statePath, actionsPath] = process.argv.slice(2);
  if (!reportPath || !statePath || !actionsPath) throw new Error('Usage: update-source-health-state <report> <state> <actions>');
  await updateSourceHealthState(reportPath, statePath, actionsPath, createSourceInventory(ruleGroups, specialRules, MIRROR_GROUPS));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

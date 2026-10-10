import fs from 'node:fs';
import process from 'node:process';

/** Append step outputs for GitHub Actions; also echo them for local runs. */
export function writeOutputs(outputs: Record<string, string | number | boolean | null | undefined>): void {
  const lines = Object.entries(outputs).map(([key, value]) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[\n\r]/.test(text)) throw new Error(`Output ${key} must be a single line`);
    return `${key}=${text}`;
  });
  for (const line of lines) console.log(`output ${line}`);
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

export function requireOption(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`Missing required option --${name}`);
  return value;
}

export function optionalInteger(values: Record<string, unknown>, name: string): number | undefined {
  const value = values[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`--${name} must be a positive integer`);
  return Number(value);
}

/** Parse a task list given as a JSON array (the prepare job output) or comma separated names. */
export function parseTasks(raw: string): string[] {
  const text = raw.trim();
  if (text.startsWith('[')) {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error('--tasks must be a JSON string array');
    return value;
  }
  const tasks: string[] = [];
  for (const item of text.split(',')) {
    if (item.trim()) tasks.push(item.trim());
  }
  return tasks;
}

export async function runCli(main: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

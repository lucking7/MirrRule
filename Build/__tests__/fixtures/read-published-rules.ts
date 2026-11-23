import fs from 'node:fs';
import path from 'node:path';

/** Read classical fixture rules from the public paths the platform actually publishes. */
export function readPublishedRules(root: string, directory: string, filename: string): string {
  if (directory !== 'List') return fs.readFileSync(path.join(root, directory, filename), 'utf8');
  const files = ['non_ip', 'ip'].map(variant => path.join(root, directory, variant, filename)).filter(file => fs.existsSync(file));
  if (!files.length) throw new Error(`Missing published Surge fixture: ${filename}`);
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

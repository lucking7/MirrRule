import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CACHE_DIR, PUBLIC_DIR } from '../constants/dir';
import { isDirectoryEmptySync } from './misc';

export interface BuildManifestV1 {
  readonly version: 1,
  readonly configHash: string,
  readonly createdAt: number
}

const MANIFEST_FILE = path.join(CACHE_DIR, 'build-manifest.json');

export function computeConfigHash(config: unknown): string {
  const payload = stableStringify(config);
  return createHash('sha256').update(payload).digest('hex');
}

export function loadManifest(): BuildManifestV1 | null {
  try {
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf-8');
    const json = JSON.parse(raw) as BuildManifestV1;
    if (json?.version === 1 && typeof json.configHash === 'string') {
      return json;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveManifest(manifest: BuildManifestV1): void {
  const dir = path.dirname(MANIFEST_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest), 'utf-8');
}

export function shouldSkipByConfigHash(configHash: string, requiredFiles?: string[]): boolean {
  const prev = loadManifest();
  if (!prev) return false;
  if (prev.configHash !== configHash) return false;

  // 基本检查：public目录存在且非空
  if (!fs.existsSync(PUBLIC_DIR) || isDirectoryEmptySync(PUBLIC_DIR)) {
    return false;
  }

  // 如果指定了必需文件，检查它们是否都存在
  if (requiredFiles && requiredFiles.length > 0) {
    for (const file of requiredFiles) {
      const fullPath = path.join(PUBLIC_DIR, file);
      if (!fs.existsSync(fullPath)) {
        return false;
      }
    }
  }

  return true;
}

function stableStringify(input: unknown): string {
  const seen = new WeakSet<object>();

  function inner(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (seen.has(value)) {
      return '"[Circular]"';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return '[' + value.map(inner).join(',') + ']';
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(k => JSON.stringify(k) + ':' + inner(obj[k]));
    return '{' + pairs.join(',') + '}';
  }

  return inner(input);
}

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export interface AtomicWriteOptions {
  mode?: number,
  createDirectory?: boolean
}

/** Replace one file through a same-directory temporary path. */
export async function writeFileAtomic(
  outputPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`
  );

  if (options.createDirectory !== false) {
    await fs.mkdir(directory, { recursive: true });
  }
  try {
    await fs.writeFile(temporaryPath, data, { flag: 'wx', mode: options.mode });
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

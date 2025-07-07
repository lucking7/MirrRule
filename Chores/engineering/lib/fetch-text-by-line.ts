import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function* readFileByLine(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    yield line;
  }
}

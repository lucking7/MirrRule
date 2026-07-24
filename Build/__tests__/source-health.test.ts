import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkSources, domainCheckExitCode, writeHealthReport } from '../validate-domain-alive';

describe('source health report', () => {
  it('classifies injected results and redacts secrets', async () => {
    let clock = 0;
    const report = await checkSources([
      { id: 'primary:a', role: 'primary', url: 'https://user:pass@ok.test/a?token=secret&public=yes' },
      { id: 'primary:b', role: 'primary', url: 'https://dead.test' },
      { id: 'primary:c', role: 'primary', url: 'https://unknown.test' },
    ], url => {
      if (url.includes('unknown')) throw new Error('token=must-not-leak');
      return Promise.resolve(url.includes('dead') ? { status: 'dead', httpStatus: 503 } : { status: 'ok', httpStatus: 204 });
    }, () => ++clock);
    assert.deepEqual(report.summary, { ok: 1, dead: 1, unknown: 1 });
    assert.equal(report.sources[1].httpStatus, 503);
    assert.equal(report.sources[2].status, 'unknown');
    assert.equal(JSON.stringify(report).includes('secret'), false);
    assert.equal(JSON.stringify(report).includes('pass@'), false);
    assert.equal(domainCheckExitCode(report), 1);
  });

  it('writes valid JSON atomically to an explicit path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-'));
    const output = path.join(directory, 'report.json');
    const report = await checkSources([], () => Promise.resolve({ status: 'ok' }));
    await writeHealthReport(output, report);
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), report);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['report.json']);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

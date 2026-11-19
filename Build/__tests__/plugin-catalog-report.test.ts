import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { UPSTREAM_UNAVAILABLE_EXIT_CODE } from '../integration/plugin-converter/readiness';
import { readConversionReport } from '../restore-optional-artifacts';

function runCli(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('plugin catalog unavailable conversion report', () => {
  it('writes a distinct catalog-unavailable report and exits 3 on localhost 403 without leaking secrets', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-catalog-report-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end('Forbidden: sensitive-upstream-body');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }));

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const secretToken = 'super-secret-token-value';
    const secretPath = '/secret-catalog/list.json';
    const catalogUrl = `http://127.0.0.1:${address.port}${secretPath}?token=${secretToken}`;
    const reportPath = path.join(directory, 'nested', 'plugin-conversion-report.json');

    const run = await runCli(
      ['-r', require.resolve('@swc-node/register'), path.resolve(__dirname, '../convert-plugins.ts')],
      {
        cwd: directory,
        env: {
          ...process.env,
          SWC_NODE_IGNORE_DYNAMIC: 'true',
          SWC_NODE_PROJECT: path.resolve(__dirname, '../../tsconfig.json'),
          PUBLIC_DIR: path.join(directory, 'public'),
          PLUGIN_LIST_URL: catalogUrl,
          PLUGIN_LIST_FORCE_PROXY: 'false',
          PROXY_BASE: '',
          PLUGIN_CONVERSION_REPORT: reportPath,
        },
      },
    );

    assert.equal(requests, 1, 'CLI must hit only the local 403 catalog server');
    assert.equal(run.status, UPSTREAM_UNAVAILABLE_EXIT_CODE, run.stdout + run.stderr);
    assert.equal(fs.existsSync(reportPath), true, 'catalog-unavailable report must be written');

    const rawReport = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(rawReport) as Record<string, unknown>;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.status, 'catalog-unavailable');
    assert.deepEqual(report.catalog, [{ source: 'direct', status: 403, outcome: 'http-error' }]);
    assert.equal(typeof report.generatedAt, 'string');
    assert.equal(Number.isNaN(Date.parse(String(report.generatedAt))), false);
    assert.equal('results' in report, false);
    assert.equal('total' in report, false);

    // The restore parser must reject a catalog-unavailable report rather than treating it as an empty catalog.
    await assert.rejects(
      readConversionReport(reportPath),
      /Unsupported plugin conversion report/,
    );

    // Neither the report nor CLI stderr may expose secret URLs, tokens, or upstream response bodies.
    for (const secret of [secretToken, secretPath, catalogUrl, 'sensitive-upstream-body']) {
      assert.equal(rawReport.includes(secret), false, `report must not expose ${secret}`);
      assert.equal(run.stderr.includes(secret), false, `stderr must not expose ${secret}`);
    }
  });
});

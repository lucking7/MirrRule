import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { UA_MIRRRULE, UA_SURGE_MAC } from '../constants/user-agents';

const scriptPath = path.join(__dirname, '..', 'check-kelee-inputs.py');

describe('Kelee input check', () => {
  it('keeps the MirrRule identity behind the Surge Mac prefix Kelee requires', () => {
    assert.ok(UA_MIRRRULE.startsWith('Surge Mac/'));
    assert.equal(UA_MIRRRULE, `${UA_SURGE_MAC} (MirrRule/1.0; +https://github.com/lucking7/MirrRule)`);
  });

  it('uses the same Kelee-compatible UA as the TypeScript client', async () => {
    const source = await readFile(scriptPath, 'utf8');
    assert.ok(source.includes(`USER_AGENT = "${UA_MIRRRULE}"`));
  });

  it('probes the Kelee plugin catalog, HTTPDNS plugin and Amap JQ resource only', async () => {
    const source = await readFile(scriptPath, 'utf8');
    const urls = [...source.matchAll(/https:\/\/(?:hub\.)?kelee\.one\/[^"]+/g)].map(([url]) => url);
    assert.deepEqual(urls.sort(), [
      'https://hub.kelee.one/list.json',
      'https://kelee.one/Resource/JQLang/Amap/updatable.jq',
      'https://kelee.one/Tool/Loon/Lpx/Block_HTTPDNS.lpx',
    ]);
  });
});

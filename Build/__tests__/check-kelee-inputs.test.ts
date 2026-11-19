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

  it('checks the current Amap JQ resource instead of the removed JS file', async () => {
    const source = await readFile(scriptPath, 'utf8');
    assert.ok(source.includes('https://kelee.one/Resource/JQLang/Amap/updatable.jq'));
    assert.ok(!source.includes('Amap_remove_ads.js'));
  });
});

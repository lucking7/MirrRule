import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createSpan } from '../trace';
import { EnhancedFileOutput } from '../lib/enhanced-file-output';
import { specialRules } from '../lib/rule-sources';

describe('excludedRules', () => {
  it('drops matching standalone rules regardless of case, leading dot, policy and modifiers', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mirrrule-excluded-rules-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const output = new EnhancedFileOutput(
      createSpan('test'), 'excluded', ['surge'], null,
      { excludedRules: ['DOMAIN-SUFFIX,us-west-2.amazonaws.com', 'domain-suffix,OneTrust.com'] }, directory
    ).withTitle('Excluded').withDescription([]);
    output.addRules([
      'DOMAIN-SUFFIX,us-west-2.amazonaws.com',
      '.us-west-2.amazonaws.com',
      'DOMAIN-SUFFIX,onetrust.com,Proxy',
      // Narrower entries and other types are not the excluded condition.
      'DOMAIN,api.us-west-2.amazonaws.com',
      'DOMAIN-SUFFIX,netflix.com',
      // Removing one child would change a logical rule's meaning, so it stays whole.
      'OR,((DOMAIN-SUFFIX,onetrust.com),(DOMAIN,example.com))',
    ]);
    const audit = await output.write();
    assert.equal(audit.stages.filtered.excludedRule, 3);
    assert.deepEqual(audit.conditions, [
      'DOMAIN,api.us-west-2.amazonaws.com',
      'DOMAIN-SUFFIX,netflix.com',
      'OR,((DOMAIN-SUFFIX,onetrust.com),(DOMAIN,example.com))',
    ]);
  });

  it('rejects entries that are not TYPE,value', () => {
    assert.throws(
      () => new EnhancedFileOutput(createSpan('test'), 'bad', ['surge'], null, { excludedRules: ['onetrust.com'] }),
      /excludedRules entry must be TYPE,value: onetrust\.com/
    );
  });

  it('excludes shared third-party suffixes from the blackmatrix7 service rules', () => {
    const netflix = specialRules.find(rule => rule.targetFile === 'List/netflix.list');
    assert.deepEqual(netflix?.excludedRules, [
      'DOMAIN-SUFFIX,us-west-2.amazonaws.com', 'DOMAIN-SUFFIX,cookielaw.org', 'DOMAIN-SUFFIX,onetrust.com',
    ]);
    const disney = specialRules.find(rule => rule.targetFile === 'List/disney.list');
    assert.deepEqual(disney?.excludedRules, ['DOMAIN-SUFFIX,execute-api.us-east-1.amazonaws.com', 'DOMAIN-SUFFIX,braze.com']);
    assert.equal(specialRules.find(rule => rule.targetFile === 'List/youtube.list')?.excludedRules, undefined);
  });
});

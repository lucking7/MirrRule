import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { task } from './trace';
import { printTraceResult, whyIsNodeRunning } from './trace';
import { downloadGEOIP } from './download-geoip';
import { ROOT_DIR } from './constants/dir';

export const buildRuleset = task(
  require.main === module,
  __filename
)(async span => {
  console.log(`Node.js ${process.versions.node} on ${os.type()} ${os.arch()}`);

  const buildFinishedLock = path.join(ROOT_DIR, '.BUILD_FINISHED');
  if (fs.existsSync(buildFinishedLock)) {
    fs.unlinkSync(buildFinishedLock);
  }

  console.log('Starting ruleset build...');
  await downloadGEOIP(span);

  await span.traceChildAsync('unified rule processing system', async span => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require for lazy loading
      const { RuleSourceProcessor } = require('./lib/rule-source-processor.ts');
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require for lazy loading
      const { ruleGroups, specialRules } = require('./lib/rule-sources.ts');

      const processor = new RuleSourceProcessor(span, 'public');
      console.log(`Processing ${ruleGroups.length} groups, ${specialRules.length} special rules`);

      const groupStats = await processor.processRuleGroups(ruleGroups);
      console.log(`Groups: ${groupStats.filesProcessed} files, ${groupStats.errors.length} errors`);

      const ruleStats = await processor.processSpecialRules(specialRules);
      console.log(`Special: ${ruleStats.filesProcessed} files, ${ruleStats.rulesMerged} rules merged`);

      const totalErrors = groupStats.errors.length + ruleStats.errors.length;
      if (totalErrors > 0) {
        console.error(`${totalErrors} errors occurred during rule processing`);
        const allErrors = [...groupStats.errors, ...ruleStats.errors];
        for (const { file, error } of allErrors) {
          console.error(`[rule-processing] ${file}: ${error}`);
        }
      }
    } catch (error) {
      console.error('Rule processing failed:', error);
      throw error;
    }
  });

  await span.traceChildAsync('build web page', async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require for lazy loading
      const { buildPublic } = require('./build-public.ts');
      await buildPublic();
    } catch (error) {
      console.error('Web page build failed:', error);
    }
  });

  fs.writeFileSync(buildFinishedLock, 'BUILD_FINISHED\n');
  printTraceResult(span.traceResult);
  await whyIsNodeRunning();
});

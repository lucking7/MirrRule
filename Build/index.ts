import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { task } from './trace';
import { printTraceResult, whyIsNodeRunning } from './trace';
import { ROOT_DIR } from './constants/dir';
import {
  executeGeoIpBuildStep,
  executeRuleProcessingBuildStep,
  executeWebBuildStep,
} from './lib/build-executors';
import { summarizeBuildSteps } from './lib/build-pipeline';

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
  const steps = [
    await span.traceChildAsync('download GEOIP', stepSpan => executeGeoIpBuildStep(stepSpan)),
    await span.traceChildAsync('unified rule processing system', stepSpan =>
      executeRuleProcessingBuildStep(stepSpan, 'public')
    ),
    await span.traceChildAsync('build web page', () => executeWebBuildStep()),
  ];

  const summary = summarizeBuildSteps(steps);
  if (!summary.success) {
    for (const error of summary.errors) {
      console.error(error);
    }
    console.error('Build completed with errors — .BUILD_FINISHED not written');
    process.exitCode = 1;
  } else {
    fs.writeFileSync(buildFinishedLock, 'BUILD_FINISHED\n');
  }

  printTraceResult(span.traceResult);
  await whyIsNodeRunning();
});

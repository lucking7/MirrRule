#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';

const BODY_MATCH_ANCHOR = String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace|mock)$/)`;
const MOCK_PREFLIGHT_ANCHOR = '  const warnings = []\n\n  for (const parsed of parsedActions) {';
const DIAGNOSTICS_ANCHOR = '  shNotify(otherRule)';
const TEMPLATE_ANCHOR = '    for (const key of surgeTemplateKeys) {';

const MOCK_PREFLIGHT = [
  '  const responseBodyMockActions = parsedActions.filter(action => action.name === \'response.body.mock\')',
  '  if (responseBodyMockActions.length > 0) {',
  '    if (phase !== \'response\') return { unsupported: true, reason: \'response.body.mock 与 request 阶段不匹配\' }',
  '    if (targetApp !== \'surge-module\') return { unsupported: true, reason: \'response.body.mock 仅支持 Surge Module 目标\' }',
  '    if (responseBodyMockActions.length !== 1 || parsedActions.length !== 1) {',
  '      return { unsupported: true, reason: \'response.body.mock 必须是唯一 Action\' }',
  '    }',
  '    const args = responseBodyMockActions[0].args',
  '    if (args.length < 2 || args.length > 4) {',
  '      return { unsupported: true, reason: \'response.body.mock 需要 contentType、body，以及可选的 status 和 isBase64\' }',
  '    }',
  '    const contentType = parseLoonV2Literal(args[0], \'response.body.mock contentType\')',
  '    const data = parseLoonV2Literal(args[1], \'response.body.mock body\')',
  '    if (contentType.reason || typeof contentType.value !== \'string\') {',
  '      return { unsupported: true, reason: contentType.reason || \'response.body.mock contentType 必须是固定字符串\' }',
  '    }',
  '    if (data.reason || typeof data.value !== \'string\') {',
  '      return { unsupported: true, reason: data.reason || \'response.body.mock body 必须是固定字符串\' }',
  '    }',
  '    const contentTypes = {',
  '      json: \'application/json\',',
  '      text: \'text/plain\',',
  '      css: \'text/css\',',
  '      html: \'text/html\',',
  '      javascript: \'text/javascript\',',
  '      plain: \'text/plain\',',
  '      png: \'image/png\',',
  '      gif: \'image/gif\',',
  '      jpeg: \'image/jpeg\',',
  '      tiff: \'image/tiff\',',
  '      svg: \'image/svg+xml\',',
  '      mp4: \'video/mp4\',',
  '      \'form-data\': \'application/x-www-form-urlencoded\',',
  '    }',
  '    const mimeType = Object.hasOwn(contentTypes, contentType.value) ? contentTypes[contentType.value] : undefined',
  '    if (typeof mimeType !== \'string\') {',
  '      return { unsupported: true, reason: \'response.body.mock 不支持 contentType=\' + contentType.value }',
  '    }',
  '    let status = 200',
  '    if (args.length >= 3) {',
  '      const parsedStatus = parseLoonV2Status(args[2], \'response.body.mock\')',
  '      if (parsedStatus.reason) return { unsupported: true, reason: parsedStatus.reason }',
  '      status = parsedStatus.value',
  '    }',
  '    let isBase64 = false',
  '    if (args.length === 4) {',
  '      const parsedBase64 = parseLoonV2Literal(args[3], \'response.body.mock isBase64\')',
  '      if (parsedBase64.reason || typeof parsedBase64.value !== \'boolean\') {',
  '        return { unsupported: true, reason: parsedBase64.reason || \'response.body.mock isBase64 必须是固定 Boolean\' }',
  '      }',
  '      isBase64 = parsedBase64.value',
  '    }',
  '    pushLoonV2MapLocal(',
  '      pattern,',
  '      isBase64 ? \'base64\' : \'text\',',
  '      data.value,',
  '      status,',
  '      \'Content-Type:\' + mimeType,',
  '      mark',
  '    )',
  '    return { handled: true, warnings: [] }',
  '  }',
  '',
].join('\n');

function countOccurrences(source: string, value: string): number {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(value, index)) !== -1) {
    count++;
    index += value.length;
  }
  return count;
}

export function patchScriptHubParser(source: string): string {
  const bodyMatchCount = countOccurrences(source, BODY_MATCH_ANCHOR);
  if (bodyMatchCount !== 1) {
    throw new Error(`Unsupported Script-Hub parser: expected exactly one response body anchor, found ${bodyMatchCount}`);
  }

  const bodyMatchIndex = source.indexOf(BODY_MATCH_ANCHOR);
  const preflightCount = countOccurrences(source.slice(0, bodyMatchIndex), MOCK_PREFLIGHT_ANCHOR);
  if (preflightCount !== 1) {
    throw new Error(`Unsupported Script-Hub parser: expected exactly one mock preflight anchor, found ${preflightCount}`);
  }

  for (const anchor of [DIAGNOSTICS_ANCHOR, TEMPLATE_ANCHOR]) {
    if (countOccurrences(source, anchor) !== 1) {
      throw new Error('Unsupported Script-Hub parser: missing or repeated diagnostics/template anchor');
    }
  }

  const withPreflight = source.replace(MOCK_PREFLIGHT_ANCHOR, `${MOCK_PREFLIGHT}${MOCK_PREFLIGHT_ANCHOR}`);
  return withPreflight.replace(
    BODY_MATCH_ANCHOR,
    String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace)$/)`
  ).replace(
    DIAGNOSTICS_ANCHOR,
    `${DIAGNOSTICS_ANCHOR}\n  if (otherRule && otherRule.includes('[Loon v2:')) body += '\\n# [Loon v2: unsupported conversion]\\n'`
  ).replace(
    TEMPLATE_ANCHOR,
    `${TEMPLATE_ANCHOR}\n      if (sgArg.some(arg => arg.key === key)) continue`
  );
}

async function main(argv: string[]): Promise<void> {
  if (argv.length !== 2) {
    throw new Error('Usage: pnpm run node Build/patch-script-hub.ts <input> <output>');
  }
  const [input, output] = argv;
  const source = await fs.readFile(input, 'utf8');
  await fs.writeFile(output, patchScriptHubParser(source), 'utf8');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

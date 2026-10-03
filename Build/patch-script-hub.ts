#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';
import { countOccurrences, patchScriptHubRegexCompatibility } from './script-hub-regex-compat';
import { patchScriptHubCaptureCompatibility } from './script-hub-capture-compat';

const BODY_MATCH_ANCHOR = String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace|mock)$/)`;
const MOCK_PREFLIGHT_ANCHOR =
  '  const warnings = []\n\n  for (const parsed of parsedActions) {';
const DIAGNOSTICS_ANCHOR = '  shNotify(otherRule)';
const TEMPLATE_ANCHOR = '    for (const key of surgeTemplateKeys) {';

const MOCK_PREFLIGHT = [
  String.raw`  const responseBodyMockActions = parsedActions.filter(action => /^(?:response\.body\.mock|response\.body\.mock_file)$/.test(action.name))`,
  '  if (responseBodyMockActions.length > 0) {',
  '    if (phase !== \'response\') return { unsupported: true, reason: \'response.body.mock 与 request 阶段不匹配\' }',
  '    if (targetApp !== \'surge-module\') return { unsupported: true, reason: \'response.body.mock 仅支持 Surge Module 目标\' }',
  '    if (responseBodyMockActions.length !== 1 || parsedActions.length !== 1) {',
  '      return { unsupported: true, reason: \'response.body.mock 必须是唯一 Action\' }',
  '    }',
  '    const args = responseBodyMockActions[0].args',
  '    const isFile = responseBodyMockActions[0].name === \'response.body.mock_file\'',
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
  '    if (isFile) {',
  '      if (args.length > 3 || ![\'text\', \'plain\', \'javascript\', \'json\', \'css\', \'svg\'].includes(contentType.value)) {',
  '        return { unsupported: true, reason: \'mock_file 仅支持静态 UTF-8 文本文件和可选 status\' }',
  '      }',
  '      try {',
  '        const fileUrl = new URL(data.value)',
  '        if (fileUrl.username || fileUrl.password || (fileUrl.protocol !== \'https:\' &&',
  '          !(fileUrl.protocol === \'http:\' && fileUrl.hostname === \'127.0.0.1\' && fileUrl.port === \'13193\'))) {',
  '          return { unsupported: true, reason: \'mock_file 必须使用 HTTPS 或本地校验网关\' }',
  '        }',
  '        const file = await http(data.value, reqHeaders)',
  '        if (Number(file?.status ?? file?.statusCode) !== 200 || typeof file?.body !== \'string\' || !file.body.trim()',
  String.raw`          || /^\s*(?:<!doctype\s+html|<(?:html|head|body|script)\b)/i.test(file.body)) {`,
  '          return { unsupported: true, reason: \'mock_file 未取得有效文本正文\' }',
  '        }',
  '        data.value = file.body',
  '      } catch (e) {',
  '        return { unsupported: true, reason: \'mock_file 下载失败\' }',
  '      }',
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

export function patchScriptHubCoreParser(source: string): string {
  const bodyMatchCount = countOccurrences(source, BODY_MATCH_ANCHOR);
  if (bodyMatchCount !== 1) {
    throw new Error(
      `Unsupported Script-Hub parser: expected exactly one response body anchor, found ${bodyMatchCount}`,
    );
  }

  const bodyMatchIndex = source.indexOf(BODY_MATCH_ANCHOR);
  const preflightCount = countOccurrences(
    source.slice(0, bodyMatchIndex),
    MOCK_PREFLIGHT_ANCHOR,
  );
  if (preflightCount !== 1) {
    throw new Error(
      `Unsupported Script-Hub parser: expected exactly one mock preflight anchor, found ${preflightCount}`,
    );
  }

  for (const anchor of [DIAGNOSTICS_ANCHOR, TEMPLATE_ANCHOR]) {
    if (countOccurrences(source, anchor) !== 1) {
      throw new Error(
        'Unsupported Script-Hub parser: missing or repeated diagnostics/template anchor',
      );
    }
  }

  const withPreflight = source.replace(
    MOCK_PREFLIGHT_ANCHOR,
    `${MOCK_PREFLIGHT}${MOCK_PREFLIGHT_ANCHOR}`,
  );
  return withPreflight
    .replace(
      BODY_MATCH_ANCHOR,
      String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace)$/)`,
    )
    .replace(
      DIAGNOSTICS_ANCHOR,
      `${DIAGNOSTICS_ANCHOR}\n  if (otherRule && otherRule.includes('[Loon v2:')) body += '\\n# [Loon v2: unsupported conversion]\\n'`,
    )
    .replace(
      TEMPLATE_ANCHOR,
      `${TEMPLATE_ANCHOR}\n      if (sgArg.some(arg => arg.key === key)) continue`,
    );
}

export function patchScriptHubParser(source: string): string {
  return patchScriptHubCaptureCompatibility(
    patchScriptHubRegexCompatibility(patchScriptHubCoreParser(source)),
  );
}

async function main(argv: string[]): Promise<void> {
  if (argv.length !== 2) {
    throw new Error(
      'Usage: pnpm run node Build/patch-script-hub.ts <input> <output>',
    );
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

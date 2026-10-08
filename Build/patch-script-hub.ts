#!/usr/bin/env node
/* eslint-disable no-template-curly-in-string -- Patch anchors contain literal upstream templates. */

import fs from 'node:fs/promises';
import process from 'node:process';
import { countOccurrences, patchScriptHubRegexCompatibility } from './script-hub-regex-compat';
import { patchScriptHubCaptureCompatibility } from './script-hub-capture-compat';

const MOCK_PREFLIGHT_ANCHOR = '  const mockActions = parsedActions.filter(action => new RegExp(`^${phase}\\\\.body\\\\.mock(?:_file)?$`).test(action.name))';
const MOCK_PARSE_ANCHOR = '      const mock = parseLoonV2BodyMockAction(name, phase, args)\n      if (mock.reason) return { unsupported: true, reason: mock.reason }';
const DIAGNOSTICS_ANCHOR = '  shNotify(otherRule)';

// Inline verified mock_file payloads before publication.
const MOCK_PREFLIGHT = String.raw`  const publicationMocks = parsedActions.filter(action => /^(?:request|response)\.body\.mock(?:_file)?$/.test(action.name))
  if (publicationMocks.length > 0 &&
      (phase !== 'response' || targetApp !== 'surge-module' || parsedActions.length !== 1)) {
    return { unsupported: true, reason: 'Published body mocks require one response Action and the Surge Module target' }
  }
`;
const MOCK_PUBLICATION = String.raw`
      if (mock.status < 200) return { unsupported: true, reason: 'Published body mocks require status 200 through 599' }
      if (mock.isFile) {
        if (args.length > 3 || !['text', 'plain', 'javascript', 'json', 'css', 'svg'].includes(mock.contentType)) {
          return { unsupported: true, reason: 'Published mock_file requires static UTF-8 text and optional status' }
        }
        try {
          const fileUrl = new URL(mock.source)
          if (fileUrl.username || fileUrl.password || (fileUrl.protocol !== 'https:' &&
              !(fileUrl.protocol === 'http:' && fileUrl.hostname === '127.0.0.1' && fileUrl.port === '13193'))) {
            return { unsupported: true, reason: 'Published mock_file requires HTTPS or the verified local gateway' }
          }
          const file = await http(mock.source, reqHeaders)
          if (Number(file?.status ?? file?.statusCode) !== 200 || typeof file?.body !== 'string' || !file.body.trim() ||
              /^\s*(?:<!doctype\s+html|<(?:html|head|body|script)\b)/i.test(file.body)) {
            return { unsupported: true, reason: 'Published mock_file did not return valid text' }
          }
          mock.source = file.body
          mock.isFile = false
        } catch (e) {
          return { unsupported: true, reason: 'Published mock_file download failed' }
        }
      }`;

function replaceExactlyOnce(source: string, anchor: string, replacement: string): string {
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    throw new Error(`Unsupported Script-Hub parser: expected exactly one publication anchor, found ${count}`);
  }
  return source.replace(anchor, () => replacement);
}

function patchScriptHubCoreParser(source: string): string {
  // Empty inline responses are valid; only resource paths must be nonempty.
  let patched = replaceExactlyOnce(source,
    '  if (typeof source.value !== \'string\' || !source.value) {',
    '  if (typeof source.value !== \'string\' || (name.endsWith(\'_file\') && !source.value)) {');
  patched = replaceExactlyOnce(patched, MOCK_PREFLIGHT_ANCHOR, MOCK_PREFLIGHT + MOCK_PREFLIGHT_ANCHOR);
  patched = replaceExactlyOnce(patched, MOCK_PARSE_ANCHOR, MOCK_PARSE_ANCHOR + MOCK_PUBLICATION);
  return replaceExactlyOnce(patched, DIAGNOSTICS_ANCHOR,
    `${DIAGNOSTICS_ANCHOR}\n  if (otherRule && otherRule.includes('[Loon v2:')) body += '\\n# [Loon v2: unsupported conversion]\\n'`);
}

export function patchScriptHubParser(source: string): string {
  return patchScriptHubCaptureCompatibility(
    patchScriptHubRegexCompatibility(patchScriptHubCoreParser(source)),
  );
}

async function main(argv: string[]): Promise<void> {
  if (argv.length !== 2) throw new Error('Usage: pnpm run node Build/patch-script-hub.ts <input> <output>');
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

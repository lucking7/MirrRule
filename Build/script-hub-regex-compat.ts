/* eslint-disable no-template-curly-in-string -- Replacement snippets contain literal JavaScript templates. */

export function countOccurrences(source: string, value: string): number {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(value, index)) !== -1) {
    count++;
    index += value.length;
  }
  return count;
}

function replaceExactlyOnce(source: string, anchor: string, replacement: string): string {
  const count = countOccurrences(source, anchor);
  if (count !== 1) throw new Error(`Unsupported Script-Hub parser: expected exactly one regex anchor, found ${count}`);
  return source.replace(anchor, () => replacement);
}

function patchFunction(source: string, name: string, next: string, patch: (section: string) => string): string {
  const start = `function ${name}(`;
  const end = `function ${next}(`;
  if (countOccurrences(source, start) !== 1 || countOccurrences(source, end) !== 1) {
    throw new Error(`Unsupported Script-Hub parser: missing or repeated ${name} boundary`);
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`Unsupported Script-Hub parser: invalid ${name} boundary order`);
  return source.slice(0, startIndex) + patch(source.slice(startIndex, endIndex)) + source.slice(endIndex);
}

const REGEX_BRANCH = String.raw`      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '[' && !regexCharacterClass) {
        regexCharacterClass = true
      } else if (char === ']' && regexCharacterClass) {
        regexCharacterClass = false
      } else if (char === '/' && !regexCharacterClass) {
        regex = false
      }`;

function patchScanner(section: string): string {
  let patched = replaceExactlyOnce(section, '  let regex = false', '  let regex = false\n  let regexCharacterClass = false');
  const compact = String.raw`      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '/') regex = false`;
  const expanded = String.raw`      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '/') {
        regex = false
      }`;
  patched = replaceExactlyOnce(patched, patched.includes(compact) ? compact : expanded, REGEX_BRANCH);
  // The argument splitter can start directly with a regex, without an opening delimiter.
  if (section.startsWith('function splitLoonV2TopLevel(')) {
    patched = replaceExactlyOnce(patched,
      String.raw`    if (char === '/' && /(?:\(|,|\[)\s*$/.test(str.slice(0, i))) {`,
      String.raw`    if (char === '/' && (current.trim() === '' || /(?:\(|,|\[)\s*$/.test(str.slice(0, i)))) {`);
  }
  return patched;
}

function patchReader(section: string): string {
  if (section.startsWith('function parseLoonV2RegexLiteral(')) {
    section = replaceExactlyOnce(section,
      '  if (!raw.startsWith(\'/\')) return { reason: `${field} 必须是正则字面量` }',
      '  if (!raw.startsWith(\'/\')) {\n    const fixed = unwrapLoonV2String(raw)\n    return fixed == null ? { reason: `${field} 必须是正则字面量或固定字符串` } : { value: fixed }\n  }');
  }
  let patched = replaceExactlyOnce(section, '  let escaped = false\n  let closing = -1',
    '  let escaped = false\n  let regexCharacterClass = false\n  let closing = -1');
  patched = replaceExactlyOnce(patched, '    if (char === \'/\' && !escaped) {', '    if (char === \'/\' && !escaped && !regexCharacterClass) {');
  const compact = String.raw`    if (escaped) escaped = false
    else if (char === '\\') escaped = true`;
  const expanded = String.raw`    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    }`;
  return replaceExactlyOnce(patched, patched.includes(compact) ? compact : expanded,
    String.raw`    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '[' && !regexCharacterClass) {
      regexCharacterClass = true
    } else if (char === ']' && regexCharacterClass) {
      regexCharacterClass = false
    }`);
}

// Native body/header replace support is owned by the pinned upstream parser.
// Character-class-aware scanning is still required across its complete argument path.
export function patchScriptHubRegexCompatibility(source: string): string {
  let patched = patchFunction(source, 'splitLoonV2TopLevel', 'splitFirstLoonV2TopLevel', patchScanner);
  patched = patchFunction(patched, 'splitLoonV2ActionList', 'stripLoonV2InlineComment', patchScanner);
  patched = patchFunction(patched, 'findLoonV2ActionClosingParen', 'parseLoonV2ActionCall', patchScanner);
  patched = patchFunction(patched, 'readLoonV2Regex', 'normalizeLoonV2Template', patchReader);
  return patchFunction(patched, 'parseLoonV2RegexLiteral', 'parseLoonV2RegexList', patchReader);
}

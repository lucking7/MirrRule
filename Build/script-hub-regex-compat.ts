/* eslint-disable no-template-curly-in-string -- The replacement snippets contain literal Loon and JavaScript templates. */
const SPLIT_START = 'function splitLoonV2TopLevel(str, sep = \',\') {';
const SPLIT_END = 'function splitFirstLoonV2TopLevel(str, sep) {';
const ACTION_PAREN_START =
  'function findLoonV2ActionClosingParen(str, openIndex) {';
const ACTION_PAREN_END = 'function parseLoonV2ActionCall(action) {';
const READ_REGEX_START = 'function readLoonV2Regex(value) {';
const READ_REGEX_END = 'function normalizeLoonV2Template(value, targetApp) {';
const HEADER_START =
  'function pushLoonV2HeaderRewrite(phase, pattern, action, args, mark = \'\') {';
const HEADER_END =
  'async function normalizeLoonV2RewriteLine(line, targetApp, sourceNum) {';
const REWRITE_END = 'function splitTopLevel(str, sep = \',\') {';

function countOccurrences(source: string, value: string): number {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(value, index)) !== -1) {
    count++;
    index += value.length;
  }
  return count;
}

function replaceExactlyOnce(
  source: string,
  anchor: string,
  replacement: string,
  description: string,
): string {
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    throw new Error(
      `Unsupported Script-Hub parser: expected exactly one ${description} anchor, found ${count}`,
    );
  }
  return source.replace(anchor, replacement);
}

function patchSection(
  source: string,
  start: string,
  end: string,
  description: string,
  patch: (section: string) => string,
): string {
  if (
    countOccurrences(source, start) !== 1 ||
    countOccurrences(source, end) !== 1
  ) {
    throw new Error(
      `Unsupported Script-Hub parser: missing or repeated ${description} boundary`,
    );
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    throw new Error(
      `Unsupported Script-Hub parser: invalid ${description} boundary order`,
    );
  }
  return (
    source.slice(0, startIndex) +
    patch(source.slice(startIndex, endIndex)) +
    source.slice(endIndex)
  );
}

// The inserted scanner logic is adapted from Script-Hub-Org/Script-Hub
// commit fa3681e26440f92cb084809d691b4e344428d665 (GPL-3.0), with regex
// character-class handling added for fixed Loon v2 regex literals.
function patchTopLevelSplitter(source: string): string {
  return patchSection(
    source,
    SPLIT_START,
    SPLIT_END,
    'splitLoonV2TopLevel',
    (section) => {
      let result = replaceExactlyOnce(
        section,
        '  let escaped = false\n  let braceDepth = 0',
        '  let escaped = false\n  let regex = false\n  let regexCharacterClass = false\n  let braceDepth = 0',
        'splitter state',
      );
      result = replaceExactlyOnce(
        result,
        `    if (char === '"' || char === "'" || char === '\`') {
      quote = char
      current += char
      continue
    }
    if (char === '{') braceDepth++`,
        `    if (regex) {
      current += char
      if (escaped) {
        escaped = false
      } else if (char === '\\\\') {
        escaped = true
      } else if (char === '[' && !regexCharacterClass) {
        regexCharacterClass = true
      } else if (char === ']' && regexCharacterClass) {
        regexCharacterClass = false
      } else if (char === '/' && !regexCharacterClass) {
        regex = false
      }
      continue
    }
    if (char === '"' || char === "'" || char === '\`') {
      quote = char
      current += char
      continue
    }
    if (char === '/' && current.trim() === '') {
      regex = true
      regexCharacterClass = false
      current += char
      continue
    }
    if (char === '{') braceDepth++`,
        'splitter regex branch',
      );
      return result;
    },
  );
}

function patchActionClosingParen(source: string): string {
  return patchSection(
    source,
    ACTION_PAREN_START,
    ACTION_PAREN_END,
    'findLoonV2ActionClosingParen',
    (section) => {
      let result = replaceExactlyOnce(
        section,
        '  let regex = false\n  let escaped = false\n  let depth = 0',
        '  let regex = false\n  let regexCharacterClass = false\n  let escaped = false\n  let depth = 0',
        'action parenthesis scanner state',
      );
      result = replaceExactlyOnce(
        result,
        String.raw`    if (regex) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '/') {
        regex = false
      }
      continue
    }`,
        String.raw`    if (regex) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '[' && !regexCharacterClass) {
        regexCharacterClass = true
      } else if (char === ']' && regexCharacterClass) {
        regexCharacterClass = false
      } else if (char === '/' && !regexCharacterClass) {
        regex = false
      }
      continue
    }`,
        'action parenthesis regex branch',
      );
      result = replaceExactlyOnce(
        result,
        String.raw`    if (char === '/' && /(?:\(|,)\s*$/.test(str.slice(0, i))) {
      regex = true
      continue
    }`,
        String.raw`    if (char === '/' && /(?:\(|,)\s*$/.test(str.slice(0, i))) {
      regex = true
      regexCharacterClass = false
      continue
    }`,
        'action parenthesis regex entry',
      );
      return result;
    },
  );
}

function patchRegexReader(source: string): string {
  return patchSection(
    source,
    READ_REGEX_START,
    READ_REGEX_END,
    'readLoonV2Regex',
    (section) => {
      let result = replaceExactlyOnce(
        section,
        '  let escaped = false\n  let closing = -1',
        '  let escaped = false\n  let regexCharacterClass = false\n  let closing = -1',
        'regex reader state',
      );
      result = replaceExactlyOnce(
        result,
        String.raw`    if (char === '/' && !escaped) {
      closing = i
      break
    }
    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    }`,
        String.raw`    if (char === '/' && !escaped && !regexCharacterClass) {
      closing = i
      break
    }
    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '[' && !regexCharacterClass) {
      regexCharacterClass = true
    } else if (char === ']' && regexCharacterClass) {
      regexCharacterClass = false
    }`,
        'regex reader scan',
      );
      return result;
    },
  );
}

function patchHeaderReplace(source: string): string {
  return patchSection(
    source,
    HEADER_START,
    HEADER_END,
    'pushLoonV2HeaderRewrite',
    (section) =>
      replaceExactlyOnce(
        section,
        '  if (args.length !== 2) return { reason: `header.${name} 需要名称和值` }',
        `  if (name === 'replace' && args.length === 3) {
    const field = parseLoonV2Literal(args[0], 'Header 名称')
    const regex = readLoonV2Regex(args[1])
    const replacement = parseLoonV2Literal(args[2], 'Header 替换值')
    if (field.reason || regex.reason || replacement.reason) {
      return { reason: field.reason || regex.reason || replacement.reason }
    }
    if (typeof field.value !== 'string' || typeof replacement.value !== 'string') {
      return { reason: 'header.replace 的名称和替换值必须是固定字符串' }
    }
    addLine('header-replace-regex', [
      quoteSurgeField(field.value),
      quoteSurgeField(regex.pattern),
      quoteSurgeField(replacement.value),
    ])
    return {}
  }

  if (args.length !== 2) return { reason: \`header.\${name} 需要名称和值\` }`,
        'three-argument header.replace',
      ),
  );
}

function patchBodyReplace(source: string): string {
  return patchSection(
    source,
    HEADER_END,
    REWRITE_END,
    'normalizeLoonV2RewriteLine',
    (section) => {
      let result = replaceExactlyOnce(
        section,
        String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace)$/)`,
        String.raw`    const bodyMatch = name.match(/^(request|response)\.body\.(replace)$/)`,
        'replace-only body matcher',
      );
      result = replaceExactlyOnce(
        result,
        `      const regex = parseLoonV2Literal(args[0], \`\${name} 正则\`)
      const replacement = parseLoonV2Literal(args[1], \`\${name} 替换值\`)
      if (regex.reason || replacement.reason) return { unsupported: true, reason: regex.reason || replacement.reason }
      rwbodyBox.push({
        type: \`http-\${phase}\`,
        regex: pattern,
        value: \`\${quoteSurgeField(regex.value)} \${quoteSurgeField(replacement.value)}\`,
        mark,
      })`,
        `      const rawRegex = \`\${args[0] ?? ''}\`.trim()
      const regex = rawRegex.startsWith('/')
        ? readLoonV2Regex(rawRegex)
        : parseLoonV2Literal(rawRegex, \`\${name} 正则\`)
      const replacement = parseLoonV2Literal(args[1], \`\${name} 替换值\`)
      if (regex.reason || replacement.reason) return { unsupported: true, reason: regex.reason || replacement.reason }
      rwbodyBox.push({
        type: \`http-\${phase}\`,
        regex: pattern,
        value: \`\${quoteSurgeField(regex.pattern ?? regex.value)} \${quoteSurgeField(replacement.value)}\`,
        mark,
      })`,
        'body.replace parser',
      );
      return result;
    },
  );
}

export function patchScriptHubRegexCompatibility(source: string): string {
  let result = patchTopLevelSplitter(source);
  result = patchActionClosingParen(result);
  result = patchRegexReader(result);
  result = patchHeaderReplace(result);
  return patchBodyReplace(result);
}

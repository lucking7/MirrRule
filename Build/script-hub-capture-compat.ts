/* eslint-disable no-template-curly-in-string -- The patch intentionally emits literal Loon templates. */
/*
 * Compatibility helpers adapted from Script-Hub-Org/Script-Hub
 * commit fa3681e26440f92cb084809d691b4e344428d665, GPL-3.0.
 */

const URL_CONDITION_ANCHOR = [
  'function parseLoonV2UrlCondition(condition) {',
  '  const source = stripLoonV2OuterParentheses(condition)',
  String.raw`  const regexMatched = source.match(/^\$\{\s*url\s*\}\s*~=\s*([\s\S]+)$/i)`,
  '  if (regexMatched) return readLoonV2Regex(regexMatched[1])',
].join('\n');

const ACTION_PREFLIGHT_ANCHOR =
  '  if (parsedActions.some(action => action.name === \'script\')) return null';

const REDIRECT_OUTPUT_ANCHOR =
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: target.value, rwtype: `${status.value}` })';
const URL_REPLACE_OUTPUT_ANCHOR =
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: target.value, rwtype: \'header\' })';
const REWRITE_CONDITION_ANCHOR =
  '  const condition = parseLoonV2UrlCondition(match[2])';

const CAPTURE_HELPERS = String.raw`
function countLoonV2RegexCaptures(pattern) {
  let count = 0
  let escaped = false
  let characterClass = false
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[') {
      characterClass = true
      continue
    }
    if (char === ']' && characterClass) {
      characterClass = false
      continue
    }
    if (char !== '(' || characterClass) continue
    if (pattern[i + 1] !== '?') {
      count++
      continue
    }
    if (pattern[i + 2] === '<' && !['=', '!'].includes(pattern[i + 3])) count++
  }
  return count
}

function splitLoonV2UrlCaptureBinding(source) {
  const suffix = source.match(/^([\s\S]*?)\s+as\s+(\S+)\s*$/i)
  if (!suffix) return { source, binding: '' }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(suffix[2])) {
    return { reason: 'URL 捕获绑定名称必须以字母开头，且只能包含字母、数字和下划线' }
  }
  return { source: suffix[1].trim(), binding: suffix[2] }
}

function normalizeLoonV2UrlReplacement(value, rawValue, condition) {
  if (!condition.binding) return { value }
  if (rawValue.trimStart().charCodeAt(0) === 96 && value.includes('$' + '{')) {
    return { reason: 'URL 替换的 raw string 中不能等价转换变量模板' }
  }
  if (/(^|[^\\])\$\d+/.test(value)) {
    return { reason: 'Loon v2 URL 替换必须使用命名捕获，不能直接使用 $n' }
  }

  let reason = ''
  const replacement = value.replace(/\$\{\s*([^{}]+?)\s*\}/g, (whole, expression) => {
    const capture = expression.match(/^([A-Za-z][A-Za-z0-9_]*)\.(0|[1-9]\d*)$/)
    if (capture) {
      if (capture[1] !== condition.binding) {
        reason = 'URL 替换引用了其他捕获绑定：${' + expression + '}'
        return whole
      }
      const index = Number(capture[2])
      if (!Number.isSafeInteger(index) || index > condition.captureCount) {
        reason = 'URL 捕获下标超出范围：${' + expression + '}'
        return whole
      }
      return '$' + capture[2]
    }
    if (expression === condition.binding) {
      reason = 'URL 捕获绑定必须使用数字下标：${' + expression + '}'
      return whole
    }
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(expression)) return '{{{' + expression + '}}}'
    reason = 'URL 替换包含无法等价转换的变量：${' + expression + '}'
    return whole
  })
  if (reason) return { reason }
  if (replacement.includes('$' + '{')) return { reason: 'URL 替换包含无法识别的变量模板' }
  return { value: replacement }
}
`;

const URL_CONDITION_REPLACEMENT = [
  'function parseLoonV2UrlCondition(condition, allowCaptureBinding = false) {',
  '  const captureBinding = splitLoonV2UrlCaptureBinding(stripLoonV2OuterParentheses(condition))',
  '  if (captureBinding.reason) return captureBinding',
  '  if (captureBinding.binding && !allowCaptureBinding) return { reason: \'Script 条件不支持 URL 捕获绑定\' }',
  '  const source = captureBinding.source',
  String.raw`  const regexMatched = source.match(/^\$\{\s*url\s*\}\s*~=\s*([\s\S]+)$/i)`,
  '  if (regexMatched) {',
  '    const parsed = readLoonV2Regex(regexMatched[1])',
  '    if (parsed.reason) return parsed',
  '    return {',
  '      ...parsed,',
  '      binding: captureBinding.binding || \'\',',
  '      captureCount: countLoonV2RegexCaptures(parsed.pattern),',
  '    }',
  '  }',
  '  if (captureBinding.binding) return { reason: \'as 捕获绑定只能用于 URL 正则条件\' }',
].join('\n');

const ACTION_PREFLIGHT_REPLACEMENT = [
  '  if (parsedActions.some(action => action.name === \'script\')) return null',
  '  if (condition.binding) {',
  '    if (phase !== \'request\') return { unsupported: true, reason: \'URL 捕获绑定只支持 request 阶段\' }',
  '    if (parsedActions.length !== 1 || ![\'redirect\', \'url.replace\'].includes(parsedActions[0].name)) {',
  '      return { unsupported: true, reason: \'URL 捕获绑定仅支持唯一的 redirect 或 url.replace Action\' }',
  '    }',
  '  }',
].join('\n');

const REDIRECT_OUTPUT_REPLACEMENT = [
  '        const replacement = normalizeLoonV2UrlReplacement(target.value, args[1], condition)',
  '        if (replacement.reason) return { unsupported: true, reason: replacement.reason }',
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: replacement.value, rwtype: `${status.value}` })',
].join('\n');

const URL_REPLACE_OUTPUT_REPLACEMENT = [
  '        const replacement = normalizeLoonV2UrlReplacement(target.value, args[0], condition)',
  '        if (replacement.reason) return { unsupported: true, reason: replacement.reason }',
  '        rwBox.push({ mark, noteK: \'\', rwptn: pattern, rwvalue: replacement.value, rwtype: \'header\' })',
].join('\n');

function countOccurrences(source: string, anchor: string): number {
  let count = 0;
  let index = 0;
  while ((index = source.indexOf(anchor, index)) !== -1) {
    count++;
    index += anchor.length;
  }
  return count;
}

function replaceExactlyOnce(
  source: string,
  anchor: string,
  replacement: string,
  label: string,
): string {
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    throw new Error(
      `Unsupported Script-Hub parser: expected exactly one ${label} anchor, found ${count}`,
    );
  }
  return source.replace(anchor, () => replacement);
}

export function patchScriptHubCaptureCompatibility(source: string): string {
  let patched = replaceExactlyOnce(
    source,
    URL_CONDITION_ANCHOR,
    `${CAPTURE_HELPERS}\n${URL_CONDITION_REPLACEMENT}`,
    'URL condition',
  );
  patched = replaceExactlyOnce(
    patched,
    REWRITE_CONDITION_ANCHOR,
    '  const condition = parseLoonV2UrlCondition(match[2], true)',
    'rewrite URL condition',
  );
  patched = replaceExactlyOnce(
    patched,
    ACTION_PREFLIGHT_ANCHOR,
    ACTION_PREFLIGHT_REPLACEMENT,
    'URL capture preflight',
  );
  patched = replaceExactlyOnce(
    patched,
    REDIRECT_OUTPUT_ANCHOR,
    REDIRECT_OUTPUT_REPLACEMENT,
    'redirect output',
  );
  return replaceExactlyOnce(
    patched,
    URL_REPLACE_OUTPUT_ANCHOR,
    URL_REPLACE_OUTPUT_REPLACEMENT,
    'URL replace output',
  );
}

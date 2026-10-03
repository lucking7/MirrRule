// Helpers adapted from Script-Hub-Org/Script-Hub@fa3681e26440f92cb084809d691b4e344428d665, GPL-3.0.
// This fixture keeps only the Loon v2 regex parsing seam used by the compatibility patch.
let rwbodyBox = []
let rwhdBox = []

function splitLoonV2TopLevel(str, sep = ',') {
  const arr = []
  let current = ''
  let quote = ''
  let escaped = false
  let braceDepth = 0
  let bracketDepth = 0
  let parenDepth = 0
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    if (quote) {
      current += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '{') braceDepth++
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1)
    if (char === '[') bracketDepth++
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (char === '(') parenDepth++
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1)
    if (char === sep && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      arr.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  arr.push(current.trim())
  return arr
}

function splitFirstLoonV2TopLevel(str, sep) {
  const parts = splitLoonV2TopLevel(str, sep)
  return [parts[0] || '', parts.slice(1).join(sep).trim()]
}

function findLoonV2ActionClosingParen(str, openIndex) {
  let quote = ''
  let regex = false
  let escaped = false
  let depth = 0
  for (let i = openIndex; i < str.length; i++) {
    const char = str[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (regex) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '/') {
        regex = false
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '/' && /(?:\(|,)\s*$/.test(str.slice(0, i))) {
      regex = true
      continue
    }
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseLoonV2ActionCall(action) {
  const match = action.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*\(/)
  if (!match) return { reason: 'Action 必须是函数调用' }
  const openIndex = action.indexOf('(', match[0].length - 1)
  const closeIndex = findLoonV2ActionClosingParen(action, openIndex)
  if (closeIndex === -1) return { reason: 'Action 缺少结束括号' }
  if (action.slice(closeIndex + 1).trim()) return { reason: 'Action 后存在无法识别的内容' }
  return {
    name: match[1].toLowerCase(),
    args: splitLoonV2TopLevel(action.slice(openIndex + 1, closeIndex)),
  }
}

function unwrapLoonV2String(value) {
  const raw = `${value ?? ''}`.trim()
  if (raw.length < 2) return null
  const quote = raw[0]
  if (!['"', "'", '`'].includes(quote) || raw[raw.length - 1] !== quote) return null
  const body = raw.slice(1, -1)
  if (quote === '"') {
    try {
      return JSON.parse(raw)
    } catch (e) {
      return null
    }
  }
  if (quote === '`') return body
  return body.replace(/\\(["'`\\])/g, '$1')
}

function parseLoonV2Literal(value, field) {
  const raw = `${value ?? ''}`.trim()
  const stringValue = unwrapLoonV2String(raw)
  if (stringValue != null) return { value: stringValue }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed === 'boolean' || typeof parsed === 'number') return { value: parsed }
  } catch (e) {
    // Continue to the shared diagnostic.
  }
  return { reason: `${field} 必须是固定字符串、数字、Boolean 或 null` }
}

function parseLoonV2LiteralList(value, field) {
  const parsed = parseLoonV2Literal(value, field)
  return parsed.reason ? parsed : { values: [parsed.value] }
}

function readLoonV2Regex(value) {
  const raw = `${value ?? ''}`.trim()
  if (!raw.startsWith('/')) return { reason: 'URL 条件右值必须是正则字面量' }

  let escaped = false
  let closing = -1
  for (let i = 1; i < raw.length; i++) {
    const char = raw[i]
    if (char === '/' && !escaped) {
      closing = i
      break
    }
    if (escaped) {
      escaped = false
    } else if (char === '\\') {
      escaped = true
    }
  }
  if (closing === -1) return { reason: 'URL 正则缺少结束分隔符 /' }

  const pattern = raw.slice(1, closing)
  const flags = raw.slice(closing + 1).trim()
  if (/[&|]|\$\{/.test(flags)) {
    return { reason: 'URL 条件包含方法、状态码、Header 或额外逻辑条件，当前无法等价转换' }
  }
  if (!/^[ims]*$/.test(flags) || new Set(flags).size !== flags.length) {
    return { reason: '仅支持 Loon v2 的 i、m、s 正则标记' }
  }
  if (/[\r\n]/.test(pattern)) {
    return { reason: 'URL 正则不能跨行，当前旧格式解析器按行解析' }
  }

  const modifiers = flags
    .split('')
    .map(flag => flag)
    .join('')
  return { pattern: modifiers ? `(?${modifiers})${pattern}` : pattern }
}

function normalizeLoonV2Template(value, targetApp) {
  return { value, targetApp }
}

function quoteSurgeField(value) {
  return `"${`${value ?? ''}`
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')}"`
}

function pushLoonV2HeaderRewrite(phase, pattern, action, args, mark = '') {
  const prefix = `http-${phase} ${pattern}`
  const addLine = (type, values) => {
    rwhdBox.push({ mark, noteK: '', x: `${prefix} ${type} ${values.join(' ')}` })
  }
  const name = action.split('.').pop()
  if (name === 'del') {
    const fields = parseLoonV2LiteralList(args[0], 'Header 名称')
    if (fields.reason || fields.values.some(item => typeof item !== 'string')) return fields
    fields.values.forEach(field => addLine('header-del', [quoteSurgeField(field)]))
    return {}
  }

  if (name === 'replace_regex') {
    if (args.length !== 3) return { reason: 'header.replace_regex 需要名称、正则和替换值' }
    const fields = parseLoonV2LiteralList(args[0], 'Header 名称')
    const regexes = parseLoonV2LiteralList(args[1], 'Header 正则')
    const replacements = parseLoonV2LiteralList(args[2], 'Header 替换值')
    if (fields.reason || regexes.reason || replacements.reason) return { reason: fields.reason || regexes.reason || replacements.reason }
    if (fields.values.length !== regexes.values.length || fields.values.length !== replacements.values.length) {
      return { reason: 'header.replace_regex 的批量参数长度不一致' }
    }
    fields.values.forEach((field, i) =>
      addLine('header-replace-regex', [quoteSurgeField(field), quoteSurgeField(regexes.values[i]), quoteSurgeField(replacements.values[i])])
    )
    return {}
  }

  if (args.length !== 2) return { reason: `header.${name} 需要名称和值` }
  const fields = parseLoonV2LiteralList(args[0], 'Header 名称')
  const values = parseLoonV2LiteralList(args[1], 'Header 值')
  if (fields.reason || values.reason) return { reason: fields.reason || values.reason }
  if (fields.values.length !== values.values.length || fields.values.some(item => typeof item !== 'string')) {
    return { reason: `header.${name} 的批量参数长度不一致或名称不是字符串` }
  }
  fields.values.forEach((field, i) => {
    const value = quoteSurgeField(values.values[i])
    if (name === 'set') {
      addLine('header-del', [quoteSurgeField(field)])
      addLine('header-add', [quoteSurgeField(field), value])
    } else {
      addLine(`header-${name}`, [quoteSurgeField(field), value])
    }
  })
  return {}
}

async function normalizeLoonV2RewriteLine(line, targetApp, sourceNum) {
  const parsed = parseLoonV2ActionCall(line)
  if (parsed.reason) return { unsupported: true, reason: parsed.reason }
  const { name, args } = parsed
  const phase = name.split('.')[0]
  const pattern = '^https://example\\.test$'
  const mark = sourceNum ? `# ${sourceNum} ` : ''

    const bodyMatch = name.match(/^(request|response)\.body\.(replace)$/)
    if (bodyMatch) {
      if (bodyMatch[1] !== phase) return { unsupported: true, reason: `${name} 与 ${phase} 阶段不匹配` }
      if (args.length !== 2) return { unsupported: true, reason: `${name} 当前需要正则和替换值两个参数` }
      const regex = parseLoonV2Literal(args[0], `${name} 正则`)
      const replacement = parseLoonV2Literal(args[1], `${name} 替换值`)
      if (regex.reason || replacement.reason) return { unsupported: true, reason: regex.reason || replacement.reason }
      rwbodyBox.push({
        type: `http-${phase}`,
        regex: pattern,
        value: `${quoteSurgeField(regex.value)} ${quoteSurgeField(replacement.value)}`,
        mark,
      })
      return { handled: true }
    }

    const headerMatch = name.match(/^(request|response)\.header\.(set|add|del|replace|replace_regex)$/)
    if (headerMatch) {
      if (headerMatch[1] !== phase) return { unsupported: true, reason: `${name} 与 ${phase} 阶段不匹配` }
      const header = pushLoonV2HeaderRewrite(phase, pattern, name, args, mark)
      if (header.reason) return { unsupported: true, reason: header.reason }
      return { handled: true }
    }

  return { unsupported: true, reason: `暂不支持 Loon v2 Action：${name}` }
}

function splitTopLevel(str, sep = ',') {
  return str.split(sep)
}

globalThis.fixtureApi = {
  normalizeLoonV2RewriteLine,
  reset() {
    rwbodyBox = []
    rwhdBox = []
  },
  getRwbodyBox() {
    return rwbodyBox
  },
  getRwhdBox() {
    return rwhdBox
  },
}

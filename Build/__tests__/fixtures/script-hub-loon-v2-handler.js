// Helpers adapted from Script-Hub-Org/Script-Hub@fa3681e26440f92cb084809d691b4e344428d665, GPL-3.0.
// Only the Loon v2 handler seam is retained for isolated patch behavior tests.
let MapLocal = []
let rwbodyBox = []

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
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
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

function splitLoonV2ActionList(str) {
  const result = []
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
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
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
    if (char === '|' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function findLoonV2ActionClosingParen(str, openIndex) {
  let quote = ''
  let escaped = false
  let depth = 0
  for (let i = openIndex; i < str.length; i++) {
    const char = str[i]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
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
  return body
    .replace(/\\(["'`\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
}

function parseLoonV2Literal(value, field) {
  const raw = `${value ?? ''}`.trim()
  const stringValue = unwrapLoonV2String(raw)
  if (stringValue != null) return { value: stringValue }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed === 'boolean' || typeof parsed === 'number') {
      return { value: parsed }
    }
  } catch (e) {
    // Continue to the shared diagnostic.
  }
  return { reason: `${field} 必须是固定字符串、数字、Boolean 或 null` }
}

function quoteSurgeField(value) {
  return `"${`${value ?? ''}`
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')}"`
}

function pushLoonV2MapLocal(pattern, dataType, data, status, header, mark = '') {
  const fields = [`${mark}${pattern}`, `data-type=${dataType}`]
  if (dataType !== 'tiny-gif') fields.push(`data=${quoteSurgeField(data ?? '')}`)
  fields.push(`status-code=${status}`)
  if (header) fields.push(`header=${quoteSurgeField(header)}`)
  MapLocal.push(fields.join(' '))
}

function parseLoonV2Status(value, actionName) {
  const parsed = parseLoonV2Literal(value, `${actionName} status`)
  if (parsed.reason || !Number.isInteger(parsed.value) || parsed.value < 100 || parsed.value > 599) {
    return { reason: `${actionName} status 必须是 100-599 的整数` }
  }
  if (parsed.value < 200 || parsed.value > 999) {
    return { reason: `Surge Map Local 不支持 ${actionName} status=${parsed.value}` }
  }
  return { value: parsed.value }
}

async function normalizeLoonV2RewriteLine(actionSource, targetApp = 'surge-module', phase = 'response') {
  const pattern = '^https://example\\.test/mock$'
  const mark = ''
  const actions = splitLoonV2ActionList(actionSource)
  const parsedActions = []
  for (const action of actions) {
    const parsed = parseLoonV2ActionCall(action)
    if (parsed.reason) return { unsupported: true, reason: parsed.reason }
    parsedActions.push(parsed)
  }
  if (parsedActions.some(action => action.name === 'script')) return null
  const warnings = []

  for (const parsed of parsedActions) {
    const { name, args } = parsed

    const bodyMatch = name.match(/^(request|response)\.body\.(replace|mock)$/)
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
      continue
    }

    return { unsupported: true, reason: `暂不支持 Loon v2 Action：${name}` }
  }
  return { handled: true, warnings }
}

globalThis.fixtureApi = {
  normalizeLoonV2RewriteLine,
  reset() {
    MapLocal = []
    rwbodyBox = []
  },
  getMapLocal() {
    return MapLocal
  },
  getRwbodyBox() {
    return rwbodyBox
  },
}

let body = ''
let otherRule = ''
const sgArg = []
const surgeTemplateKeys = new Set()
function shNotify() {}
function fixtureFinish(value, diagnostics, parameters, keys) {
  body = value
  otherRule = diagnostics
  sgArg.splice(0, sgArg.length, ...parameters)
  surgeTemplateKeys.clear()
  keys.forEach(key => surgeTemplateKeys.add(key))
    for (const key of surgeTemplateKeys) {
      body = body.replaceAll('{' + key + '}', '{{{' + key + '}}}')
    }
  shNotify(otherRule)
  return body
}
globalThis.fixtureApi.finish = fixtureFinish

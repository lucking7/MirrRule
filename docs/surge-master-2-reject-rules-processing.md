# Surge-master-2 Reject 规则处理流程详解

## 1. 数据源分类与验证策略

### 本地源文件（宽松验证）

```typescript
// build-reject-domainset.ts
const readLocalRejectDomainsetPromise = readFileIntoProcessedArray(
  path.join(SOURCE_DIR, 'domainset/reject.conf')
);
const readLocalRejectExtraDomainsetPromise = readFileIntoProcessedArray(
  path.join(SOURCE_DIR, 'domainset/reject_extra.conf')
);
```

- **验证策略**：宽松模式，接受 ICANN TLD 和私有后缀
- **处理方式**：直接读取，不进行 TLD 过滤

### AdGuard 过滤器（严格验证）

```typescript
// 定义 AdGuard 过滤器列表
export const ADGUARD_FILTERS: AdGuardFilterSource[] = [
  // AdGuard 基础过滤器
  ['https://filters.adtidy.org/extension/ublock/filters/2_optimized.txt', [...]],
  // EasyPrivacy
  ['https://easylist.to/easylist/easyprivacy.txt', [...]],
  // 其他过滤器...
];

// 处理 AdGuard 过滤器
const adguardFiltersDownloads = ADGUARD_FILTERS.map(entry =>
  processFilterRulesWithPreload(...entry)
);
```

### 严格验证的实现

```typescript
// lib/parse-filter/filters.ts
export function parse(line: string, result: [string, ParseType], includeThirdParty: boolean) {
  // 使用 tldts 解析域名
  const parsed = tldts.parse(domain, normalizeTldtsOpt);

  // AdGuard 过滤器的严格验证
  if (!parsed.publicSuffix || !parsed.isIcann || !parsed.hostname || !parsed.domain) {
    result[1] = ParseType.Null; // 过滤掉
    return result;
  }
}
```

## 2. 合并流程

```typescript
// build-reject-domainset.ts
await span.traceAsyncFn((childSpan) => Promise.all([
  // 1. 处理本地文件（宽松）
  appendArrayToRejectOutput(readLocalRejectDomainsetPromise),

  // 2. 处理远程 hosts 文件（宽松）
  hostsDownloads.map(task => task(childSpan).then(appendArrayToRejectOutput)),

  // 3. 处理远程域名列表（宽松）
  domainListsDownloads.map(task => task(childSpan).then(appendArrayToRejectOutput)),

  // 4. 处理 AdGuard 过滤器（严格）
  adguardFiltersDownloads.map(
    task => task(childSpan).then(({ blackDomains, blackDomainSuffixes, ... }) => {
      // 添加黑名单域名
      rejectDomainsetOutput.bulkAddDomain(blackDomains);
      rejectDomainsetOutput.bulkAddDomainSuffix(blackDomainSuffixes);
      // ...
    })
  ),
]));
```

## 3. 白名单处理

```typescript
// 预定义白名单
const filterRuleWhitelistDomainSets = new Set(PREDEFINED_WHITELIST);

// 从 AdGuard 过滤器收集白名单
addArrayElementsToSet(filterRuleWhitelistDomainSets, whiteDomains);

// 应用白名单
span.traceChildSync('whitelist', () => {
  for (const domain of filterRuleWhitelistDomainSets) {
    rejectDomainsetOutput.whitelistDomain(domain);
    rejectExtraDomainsetOutput.whitelistDomain(domain);
  }
});
```

## 4. adtago.s3.amazonaws.com 的处理示例

### 场景 1：如果在本地 reject.conf 中

```
# Source/domainset/reject.conf
adtago.s3.amazonaws.com
```

- **结果**：✅ 保留（宽松验证，接受私有后缀）

### 场景 2：如果在 AdGuard 过滤器中

```
# AdGuard 过滤器
||adtago.s3.amazonaws.com^
```

- **解析时**：被识别为私有后缀（isPrivate=true）
- **结果**：❌ 被过滤（严格验证，不接受私有后缀）

### 场景 3：如果在 CNAME 追踪器列表中

```
# AdGuard CNAME trackers (纯域名列表格式)
adtago.s3.amazonaws.com
```

- **处理方式**：使用 `processDomainListsWithPreload`（宽松验证）
- **结果**：✅ 保留

## 5. 关键差异总结

| 数据源类型     | 验证模式 | 私有后缀处理 | 示例                  |
| -------------- | -------- | ------------ | --------------------- |
| 本地文件       | 宽松     | ✅ 接受      | reject.conf           |
| Hosts 文件     | 宽松     | ✅ 接受      | StevenBlack hosts     |
| 域名列表       | 宽松     | ✅ 接受      | CNAME trackers        |
| AdGuard 过滤器 | 严格     | ❌ 拒绝      | EasyList、EasyPrivacy |

## 6. 实际影响

1. **大部分追踪器域名都能正确保留**：

   - 因为 CNAME 追踪器列表是作为域名列表处理的（宽松模式）
   - 本地维护的 reject 规则也是宽松模式

2. **AdGuard 过滤器的贡献有限**：

   - 使用私有后缀的域名会被过滤掉
   - 但这些域名通常会通过其他来源（如 CNAME 追踪器列表）被加入

3. **这是一个平衡的设计**：
   - 对外部 AdGuard 过滤器严格，避免引入问题域名
   - 对自己维护的规则宽松，保证覆盖面

## 7. 在 esdeath 中的实现建议

1. **区分数据源**：

   ```typescript
   // 判断数据源
   if (source.includes('filters.adtidy.org') || source.includes('easylist')) {
     // AdGuard 过滤器 - 严格模式
     validator.validate(domain, { source: RuleSource.AdGuardFilter });
   } else {
     // 其他来源 - 宽松模式
     validator.validate(domain, { source: RuleSource.LocalFile });
   }
   ```

2. **配置化管理**：

   ```typescript
   const SOURCE_CONFIG = {
     'reject.conf': { mode: 'lenient' },
     'reject_extra.conf': { mode: 'lenient' },
     adguard_filters: { mode: 'strict' },
     cname_trackers: { mode: 'lenient' },
   };
   ```

3. **保持灵活性**：
   - 允许用户配置每个数据源的验证模式
   - 提供详细的日志，说明哪些域名被过滤及原因

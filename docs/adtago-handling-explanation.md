# Surge-master-2 TLD 验证逻辑及 adtago.s3.amazonaws.com 分析

## 1. Surge-master-2 对 reject 规则的 TLD 验证逻辑

### 1.1 TLD 验证的核心机制

在 Surge-master-2 中，TLD 验证主要通过 `tldts-experimental` 库实现，关键逻辑位于 `Build/lib/parse-filter/filters.ts`：

```typescript
// 文件：Build/lib/parse-filter/filters.ts，第 566-579 行
if (!parsed.publicSuffix || !parsed.isIcann || !parsed.hostname || !parsed.domain) {
  result[1] = ParseType.Null;
  return result;
}
```

核心验证条件：

- `parsed.publicSuffix` - 必须有合法的公共后缀（TLD）
- `parsed.isIcann` - 必须是 ICANN 认证的 TLD
- `parsed.hostname` - 必须能解析出主机名
- `parsed.domain` - 必须能解析出域名

**重要发现**：这个验证逻辑会过滤掉非 ICANN TLD，如 `.tor`、`.onion`、`.dn42` 等。

### 1.2 Reject 规则的特殊处理

与普通规则不同，reject 规则有以下特殊处理：

1. **预定义白名单（PREDEFINED_WHITELIST）**

   - 包含 CRASHLYTICS_WHITELIST（64 个崩溃报告服务域名）
   - 本地域名（.localhost、.local 等）
   - 各种误报域名（如 analytics.google.com、.t.co 等）
   - 共计 100+ 个域名

2. **白名单应用流程**（`build-reject-domainset.ts` 第 220-239 行）：

   ```typescript
   // 对所有 reject 域名集应用白名单
   for (const domain of filterRuleWhitelistDomainSets) {
     rejectDomainsetOutput.whitelistDomain(domain);
     rejectExtraDomainsetOutput.whitelistDomain(domain);
     rejectPhisingDomainsetOutput.whitelistDomain(domain);
   }
   ```

3. **关键差异**：reject non_ip ruleset 不应用白名单（第 227 行注释）
   ```typescript
   // DON'T Whitelist reject non_ip ruleset, we are force blocking things here
   ```

## 2. adtago.s3.amazonaws.com 的具体情况

### 2.1 域名分析

```
完整域名：adtago.s3.amazonaws.com
tldts 解析结果：
- hostname: adtago.s3.amazonaws.com
- domain: adtago.s3.amazonaws.com
- publicSuffix: s3.amazonaws.com（私有后缀）
- isIcann: false（不是 ICANN TLD）
- isPrivate: true（是私有后缀）
```

**关键发现**：`s3.amazonaws.com` 被 Public Suffix List 列为**私有后缀**，因此 `isIcann = false`。

### 2.2 为什么应该保留在 reject 规则集中

1. **域名用途**：adtago 是一个已知的广告/追踪服务
2. **托管位置**：使用 AWS S3 服务托管
3. **追踪器特性**：即使托管在合法的 CDN/云服务上，追踪器仍应被阻止

### 2.3 Surge-master-2 的处理策略

Surge-master-2 对 CDN/云服务上的追踪器采用以下策略：

1. **不因 CDN 而豁免**：即使追踪器托管在知名 CDN（如 AWS、Cloudflare）上，仍会被阻止
2. **精确域名匹配**：通过精确匹配具体的追踪器域名，而不是整个 CDN 域名
3. **CNAME 追踪器处理**：通过 AdGuard CNAME 追踪器列表识别隐藏的追踪器

示例（来自 PREDEFINED_WHITELIST）：

```
'.compute.amazonaws.com', // rDNS 用途，但不影响具体追踪器域名
'.r2.dev', // 虽然有 5000+ 钓鱼实例，但必须白名单整个域
```

## 3. Surge-master-2 的实际处理流程

### 3.1 AdGuard 过滤器解析（parse-filter/filters.ts）

对于从 AdGuard 过滤器导入的规则，处理逻辑如下：

```typescript
// 第 566-579 行
if (!parsed.publicSuffix || !parsed.isIcann || !parsed.hostname || !parsed.domain) {
  result[1] = ParseType.Null; // 过滤掉
  return result;
}
```

**这意味着**：来自 AdGuard 过滤器的私有后缀域名（如 adtago.s3.amazonaws.com）会被过滤掉。

### 3.2 本地规则和域名列表处理

但是，对于本地源文件（如 `Source/domainset/reject.conf`）中的域名，使用的是不同的处理逻辑：

- 使用 `normalize-domain.ts` 中的函数
- 接受私有后缀：`if (!parsed.isIcann && !parsed.isPrivate) return null;`

### 3.3 完整判断逻辑图

```
域名输入来源
  ├─ AdGuard 过滤器
  │   ↓
  │   检测 isIcann
  │   ├─ false（私有后缀）→ 过滤掉（ParseType.Null）
  │   └─ true（ICANN TLD）→ 继续处理
  │
  └─ 本地源文件/域名列表
      ↓
      检测 isIcann || isPrivate
      ├─ 都是 false → 过滤掉（如 .tor、.onion）
      └─ 至少一个 true → 继续处理
          ↓
      检查预定义白名单（PREDEFINED_WHITELIST）
      ├─ 在白名单中 → 排除
      └─ 不在白名单中 → 加入 reject
```

## 4. 最佳实践建议

1. **保留 adtago.s3.amazonaws.com**：这是一个合法的追踪器域名，应该保留在 reject 规则集中

2. **不要过度信任 CDN**：

   - 错误做法：白名单整个 `.amazonaws.com`
   - 正确做法：只白名单必要的服务，精确阻止追踪器

3. **参考 Surge-master-2 的平衡策略**：
   - 对崩溃报告服务宽容（CRASHLYTICS_WHITELIST）
   - 对追踪器严格（即使在知名 CDN 上）
   - 对误报域名及时修正（PREDEFINED_WHITELIST）

## 5. 关于 adtago.s3.amazonaws.com 的处理建议

### 5.1 在 Surge-master-2 中的情况

如果 `adtago.s3.amazonaws.com` 出现在：

- **AdGuard 过滤器中**：会被自动过滤掉（因为 s3.amazonaws.com 是私有后缀）
- **本地源文件中**：会被保留（因为接受私有后缀）

### 5.2 在 esdeath 项目中的建议

1. **保留在 reject 规则集中**：

   - adtago 是已知的广告/追踪服务
   - 即使托管在 AWS S3 上，追踪器仍应被阻止
   - 符合"基于用途而非托管位置"的原则

2. **处理私有后缀的策略**：

   - 方案 A：像 Surge-master-2 一样，区分来源（AdGuard vs 本地）
   - 方案 B：统一接受私有后缀域名（更宽松）
   - 方案 C：将 s3.amazonaws.com 等常见 CDN 私有后缀加入特殊白名单

3. **推荐方案**：
   - 短期：保留 adtago.s3.amazonaws.com，它是合法的追踪器
   - 长期：参考 Surge-master-2，建立更精细的私有后缀处理策略

## 6. 总结

1. **域名性质**：`adtago.s3.amazonaws.com` 使用私有后缀，但是合法域名
2. **Surge-master-2 策略**：对 AdGuard 过滤器严格（过滤私有后缀），对本地规则宽松
3. **核心原则**：基于域名用途判断，而非技术细节或托管位置
4. **建议操作**：保留该域名在 reject 规则集中，因为它是追踪器

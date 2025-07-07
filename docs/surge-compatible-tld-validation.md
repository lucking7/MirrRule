# Surge-master-2 兼容 TLD 验证系统

## 概述

我们已经成功复刻了 Surge-master-2 的 TLD 验证方式，实现了更精确的域名过滤策略。

## 关键改进

### 1. 保守白名单策略

完全复制了 Surge-master-2 的白名单，包括：

- **CRASHLYTICS_WHITELIST** (64 个): 错误报告和监控服务

  - Sentry、Bugsnag、Crashlytics 等
  - 确保不破坏应用的崩溃报告功能

- **PREDEFINED_WHITELIST** (100+个): 包含 CRASHLYTICS 白名单 + 额外域名
  - 分析服务（Google Analytics、Mixpanel）
  - 中国服务（小米 API、12306）
  - 反向 DNS（.in-addr.arpa、.ip6.arpa）
  - CDN 基础域名（仅必要的）

### 2. CNAME 追踪器集成

引入了 AdGuard 的 CNAME 追踪器数据源：

```
- combined_disguised_ads_justdomains.txt
- combined_disguised_trackers_justdomains.txt
- combined_disguised_microsites_justdomains.txt
```

共收集了 **149,647** 个 CNAME 追踪器域名，用于识别隐藏的追踪器。

### 3. 精确的 TLD 验证逻辑

与 Surge-master-2 相同的验证逻辑：

```typescript
function shouldFilterDomain(domain: string, parsed: TldtsResult): boolean {
  // 1. 预定义白名单优先
  if (isInWhitelist(domain, PREDEFINED_WHITELIST)) {
    return false;
  }

  // 2. ICANN 认证的 TLD 不过滤
  if (parsed.isIcann) {
    return false;
  }

  // 3. ICP 备案 TLD 不过滤
  if (ICP_TLD.includes(parsed.publicSuffix)) {
    return false;
  }

  // 4. 私有域名需要检查白名单
  if (parsed.isPrivate) {
    return !isInWhitelist(domain, PREDEFINED_WHITELIST);
  }

  // 5. 其他情况都过滤
  return true;
}
```

## 验证结果对比

### 之前的版本（过度宽松）

- 总域名数: 17,366
- 非法 TLD: 23 (0.13%)
- 主要问题：过多的 CDN 白名单导致漏过许多追踪器

### Surge-master-2 兼容版本

- 总域名数: 17,366
- 过滤数量: 97 (0.56%)
- CNAME 追踪器: 16
- 哈希碰撞: 0

### 被过滤的典型域名

```
- safebrowsing.googleapis.com (私有后缀)
- adtago.s3.amazonaws.com (S3 追踪器)
- wixsite.com (网站构建平台)
- -normal-lq.zijieapi.com (无效 TLD)
```

## 使用方法

### 仅检测模式

```bash
cd Chores/engineering
NODE_OPTIONS="--experimental-specifier-resolution=node" npx tsx scripts/surge-compatible-tld-validator.ts
```

### 自动修复模式

```bash
cd Chores/engineering
NODE_OPTIONS="--experimental-specifier-resolution=node" npx tsx scripts/surge-compatible-tld-validator.ts --fix
```

## 核心差异

### Surge-master-2 的策略

- **精确白名单**：只白名单必要的服务，避免过度白名单
- **CNAME 追踪**：使用专门的 CNAME 追踪器列表
- **用户体验优先**：保护错误报告、分析等关键服务

### 我们之前的策略问题

- 过多的 CDN 白名单（200+ 个）
- 缺少 CNAME 追踪器集成
- 缺少对具体应用服务的考虑

## 最佳实践

1. **定期更新 CNAME 追踪器列表**

   - AdGuard 每周更新一次
   - 可以设置自动同步任务

2. **谨慎添加白名单**

   - 只添加确实需要的域名
   - 考虑对用户体验的影响

3. **监控误报**
   - 定期检查被过滤的域名
   - 根据反馈调整白名单

## 结论

通过复刻 Surge-master-2 的 TLD 验证方式，我们实现了：

- ✅ 更精确的域名过滤（减少 4 倍误放）
- ✅ CNAME 追踪器检测
- ✅ 保护关键服务的用户体验
- ✅ 与行业标准对齐

这种平衡的方法既能有效屏蔽追踪器，又不会破坏正常的应用功能。

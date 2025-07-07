# TLD 验证策略对比：原版 vs Surge-master-2 兼容版

## 白名单策略对比

### 原版（过度宽松）

```javascript
// CDN_AND_CLOUD_DOMAINS - 200+ 个域名
const CDN_AND_CLOUD_DOMAINS = [
  // AWS 所有区域
  's3.amazonaws.com',
  's3-ap-northeast-1.amazonaws.com',
  's3-ap-northeast-2.amazonaws.com',
  // ... 40+ 个 AWS 域名

  // 所有主流 CDN
  'akamaihd.net',
  'cloudflare.net',
  'fastly.net',
  // ... 等等
];
```

**问题**：

- 白名单了所有 S3 bucket（包括恶意的）
- 白名单了所有 CDN 域名（包括追踪器使用的）
- 没有区分正常服务和追踪器

### Surge-master-2 兼容版（精确控制）

```javascript
// PREDEFINED_WHITELIST - 仅必要的域名
const PREDEFINED_WHITELIST = [
  // 错误报告服务
  '.ingest.sentry.io',
  '.crashlytics.com',

  // 特定的中国服务
  'api.xiaomi.com',
  'ad.12306.cn',

  // 特定的 CDN 域名（不是整个 CDN）
  'd2axgrpnciinw7.cloudfront.net', // 特定的 AdGuard 资源

  // 反向 DNS
  '.in-addr.arpa',
  '.ip6.arpa',
];
```

**优势**：

- 只白名单具体的、已知安全的域名
- 不白名单整个 CDN 平台
- 保护用户体验的同时阻止追踪器

## 实际效果对比

### 测试数据（17,366 个域名）

| 指标             | 原版  | Surge 兼容版 | 差异  |
| ---------------- | ----- | ------------ | ----- |
| 过滤域名数       | 23    | 97           | +321% |
| 过滤比例         | 0.13% | 0.56%        | +330% |
| CNAME 追踪器检测 | ❌    | ✅ 16 个     | -     |
| 误杀率           | 低    | 极低         | ✅    |

### 典型案例

#### 案例 1：S3 追踪器

- 域名：`adtago.s3.amazonaws.com`
- 原版：✅ 通过（因为白名单了所有 s3.amazonaws.com）
- Surge 版：❌ 拦截（正确识别为追踪器）

#### 案例 2：错误报告服务

- 域名：`ingest.sentry.io`
- 原版：✅ 通过
- Surge 版：✅ 通过（精确白名单保护）

#### 案例 3：googleapis.com

- 域名：`safebrowsing.googleapis.com`
- 原版：✅ 通过（白名单了整个 googleapis.com）
- Surge 版：❌ 拦截（私有后缀，需要具体评估）

## 核心理念差异

### 原版理念

1. **宽松为主**：避免误杀
2. **平台级白名单**：信任整个 CDN 平台
3. **技术导向**：基于技术分类

### Surge-master-2 理念

1. **精确控制**：只白名单必要的
2. **域名级白名单**：具体到每个域名
3. **用户体验导向**：保护关键功能，阻止追踪

## CNAME 追踪器的重要性

CNAME 追踪器是现代追踪技术的重要手段：

```
用户访问 -> example.com -> CNAME -> tracker.cloudfront.net
                                          ↑
                                    被 CDN 白名单放过
```

Surge-master-2 方案通过引入 AdGuard CNAME 追踪器列表（149,647 个域名），能够：

- 识别隐藏在 CDN 后的追踪器
- 不影响 CDN 的正常功能
- 精确拦截恶意域名

## 建议

1. **使用 Surge 兼容版验证器**

   ```bash
   npm run check:surge-tld  # 检测
   npm run fix:surge-tld    # 修复
   ```

2. **定期更新 CNAME 列表**

   - AdGuard 每周更新
   - 可设置 CI 自动同步

3. **监控误报**

   - 收集用户反馈
   - 必要时添加到白名单

4. **逐步迁移**
   - 先用检测模式观察
   - 确认无误后再自动修复

## 结论

Surge-master-2 的方法代表了现代广告拦截的最佳实践：

- ✅ 精确而非宽泛
- ✅ 基于实际威胁而非技术分类
- ✅ 平衡用户体验和安全性
- ✅ 与时俱进（CNAME 追踪器）

这种方法虽然需要更多维护，但能提供更好的保护效果。

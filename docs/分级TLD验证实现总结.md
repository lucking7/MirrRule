# 分级 TLD 验证功能实现总结

## 背景

用户要求参考 Surge-master-2 的实现，为 esdeath 项目添加分级 TLD 验证功能，解决 `adtago.s3.amazonaws.com` 这类使用私有后缀的域名的处理问题。

## 核心理念

**Surge-master-2 的分级处理策略**：

- **AdGuard 过滤器（严格）**：只接受 ICANN 认证的 TLD，过滤私有后缀
- **本地规则文件（宽松）**：接受 ICANN TLD 和私有后缀，只过滤非标准 TLD

## 实现的功能

### 1. AdGuard 过滤器解析器

**文件**: `lib/parse-filter/adguard-filter.ts`

```typescript
// 使用示例
import { parseAdGuardFilter } from './lib/parse-filter/adguard-filter.js';

const result = parseAdGuardFilter(filterContent);
// result 包含: whiteDomains, blackDomains, blackIPs 等
```

### 2. 增强的 TLD 验证器

**文件**: `lib/enhanced-tld-validator.ts`

```typescript
// 使用示例
import { EnhancedTldValidator, RuleSource } from './lib/enhanced-tld-validator.js';

const validator = new EnhancedTldValidator();

// AdGuard 过滤器模式（严格）
const result1 = validator.validate('adtago.s3.amazonaws.com', {
  source: RuleSource.AdGuardFilter,
}); // 返回: { valid: false, reason: '非 ICANN 认证的 TLD: s3.amazonaws.com' }

// 本地文件模式（宽松）
const result2 = validator.validate('adtago.s3.amazonaws.com', {
  source: RuleSource.LocalFile,
}); // 返回: { valid: true }
```

### 3. 辅助模块

- **IP 检查**: `lib/utils/ip-check.ts`
- **tldts 配置**: `lib/constants/tldts-options.ts`
- **AdGuard 配置**: `sync/rule-adguard-config.ts`

## adtago.s3.amazonaws.com 的处理结果

| 模式           | 结果      | 原因                                        |
| -------------- | --------- | ------------------------------------------- |
| AdGuard 过滤器 | ❌ 被过滤 | s3.amazonaws.com 是私有后缀，不是 ICANN TLD |
| 本地规则文件   | ✅ 保留   | 接受私有后缀域名                            |

**结论**: 即使在 AdGuard 过滤器中被过滤，`adtago.s3.amazonaws.com` 作为已知追踪器仍应保留在 reject 规则集中。

## 使用方法

### 1. 运行演示

```bash
npm run demo:enhanced-tld
```

### 2. 检查 reject 规则

```bash
# 仅检查
npm run check:reject-tld

# 自动修复
npm run fix:reject-tld
```

### 3. 在代码中集成

```typescript
// 判断规则来源
const source = isFromAdGuard ? RuleSource.AdGuardFilter : RuleSource.LocalFile;

// 验证域名
const result = validator.validate(domain, { source });

if (!result.valid) {
  console.log(`域名被过滤: ${result.reason}`);
}
```

## 技术要点

### 1. tldts 库的使用

- 必须启用 `allowPrivateDomains: true` 才能正确识别私有后缀
- 然后根据 `isPrivate` 标志判断是否为私有后缀

### 2. 验证流程

1. 使用宽松配置解析域名，获取完整信息
2. 根据规则来源（AdGuard vs 本地）应用不同的验证策略
3. AdGuard：拒绝私有后缀；本地：接受私有后缀

### 3. 白名单机制

- ICP 备案 TLD（130 个）
- 特殊用途 TLD（如 .local、.localhost）
- 预定义白名单（崩溃报告服务等）

## 与 Surge-master-2 的对比

| 功能               | Surge-master-2 | esdeath（实现后） |
| ------------------ | -------------- | ----------------- |
| AdGuard 过滤器解析 | ✅ 完整实现    | ✅ 基础实现       |
| 分级 TLD 验证      | ✅ 支持        | ✅ 支持           |
| 私有后缀处理       | ✅ 区分来源    | ✅ 区分来源       |
| CNAME 追踪器       | ✅ 3 个列表    | ✅ 配置已定义     |
| 预定义白名单       | ✅ 100+ 域名   | ✅ 可扩展         |

## 后续优化建议

1. **完整的 AdGuard 过滤器集成**：将 AdGuard 过滤器作为数据源集成到构建流程中
2. **自动来源识别**：根据文件路径或 URL 自动判断规则来源
3. **更多过滤器支持**：支持 EasyList、uBlock Origin 等其他格式
4. **CI/CD 集成**：在 GitHub Actions 中自动验证新增规则的 TLD 合法性
5. **性能优化**：为大量域名验证添加缓存机制

## 文件列表

实现的文件：

- `lib/enhanced-tld-validator.ts` - 增强的 TLD 验证器
- `lib/parse-filter/adguard-filter.ts` - AdGuard 过滤器解析器
- `lib/utils/ip-check.ts` - IP 地址检查工具
- `lib/constants/tldts-options.ts` - tldts 配置选项
- `sync/rule-adguard-config.ts` - AdGuard 过滤器配置
- `scripts/demo-enhanced-tld-validation.ts` - 功能演示脚本
- 更新了 `scripts/check-reject-tld.ts` - 集成新验证器

文档：

- `docs/enhanced-tld-validation-implementation.md` - 英文实现文档
- `docs/分级TLD验证实现总结.md` - 中文总结（本文档）
- `docs/adtago-handling-explanation.md` - adtago 域名分析
- `docs/surge-master-2-tld-analysis.md` - Surge-master-2 分析

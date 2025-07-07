# 增强 TLD 验证功能实现总结

## 概述

根据 Surge-master-2 的实现，我们为 esdeath 项目添加了分级 TLD 验证功能，可以根据规则来源（AdGuard 过滤器 vs 本地文件）使用不同的验证策略。

## 实现的功能

### 1. AdGuard 过滤器解析器

- **文件**: `lib/parse-filter/adguard-filter.ts`
- **功能**:
  - 解析 AdGuard 过滤器格式的规则
  - 使用严格的 TLD 验证（只接受 ICANN TLD）
  - 支持白名单、黑名单、通配符等规则类型
  - 可从 URL 下载并解析过滤器

### 2. 增强的 TLD 验证器

- **文件**: `lib/enhanced-tld-validator.ts`
- **功能**:
  - 根据规则来源使用不同的验证策略
  - 支持四种来源类型：AdGuardFilter、LocalFile、RemoteList、Unknown
  - 内置 ICP TLD 白名单和特殊用途 TLD 白名单
  - 提供批量验证和报告生成功能

### 3. 辅助工具

- **IP 检查工具**: `lib/utils/ip-check.ts`
  - IPv4 和 IPv6 地址检测
- **tldts 配置**: `lib/constants/tldts-options.ts`
  - 定义严格、宽松、规范化三种配置选项

### 4. 配置文件

- **文件**: `sync/rule-adguard-config.ts`
- **内容**:
  - AdGuard 过滤器列表定义
  - CNAME 追踪器列表
  - 预定义白名单

## 验证策略对比

| 来源类型       | 验证策略 | 接受的域名类型            |
| -------------- | -------- | ------------------------- |
| AdGuard 过滤器 | 严格模式 | 只接受 ICANN 认证的 TLD   |
| 本地规则文件   | 宽松模式 | 接受 ICANN TLD 和私有后缀 |
| 远程域名列表   | 宽松模式 | 接受 ICANN TLD 和私有后缀 |

## adtago.s3.amazonaws.com 的处理

- **域名性质**: 使用私有后缀 `s3.amazonaws.com`
- **AdGuard 过滤器处理**: 会被过滤（因为不是 ICANN TLD）
- **本地规则处理**: 会被保留（因为接受私有后缀）
- **建议**: 作为追踪器应该保留在 reject 规则集中

## 使用方法

### 1. 基本使用

```typescript
import { EnhancedTldValidator, RuleSource } from './lib/enhanced-tld-validator.js';

const validator = new EnhancedTldValidator();

// 验证单个域名
const result = validator.validate('example.com', {
  source: RuleSource.AdGuardFilter,
});

// 批量验证
const results = validator.validateBatch(domains, {
  source: RuleSource.LocalFile,
});
```

### 2. 解析 AdGuard 过滤器

```typescript
import {
  parseAdGuardFilter,
  fetchAndParseAdGuardFilter,
} from './lib/parse-filter/adguard-filter.js';

// 从内容解析
const result = parseAdGuardFilter(filterContent);

// 从 URL 下载并解析
const result = await fetchAndParseAdGuardFilter(url);
```

### 3. 运行演示

```bash
# 运行增强 TLD 验证演示
npm run demo:enhanced-tld

# 或直接运行
tsx scripts/demo-enhanced-tld-validation.ts
```

## 与现有代码的集成

`scripts/check-reject-tld.ts` 已更新为使用新的增强验证器：

- 移除了原有的 `shouldFilterDomain` 函数
- 使用 `EnhancedTldValidator` 进行验证
- 支持更详细的错误信息

## NPM Scripts

建议添加以下脚本到 `package.json`:

```json
{
  "scripts": {
    "demo:enhanced-tld": "tsx Chores/engineering/scripts/demo-enhanced-tld-validation.ts",
    "check:reject-tld": "tsx Chores/engineering/scripts/check-reject-tld.ts",
    "fix:reject-tld": "tsx Chores/engineering/scripts/check-reject-tld.ts --fix"
  }
}
```

## 后续扩展建议

1. **自动识别来源**: 可以根据文件路径或 URL 自动判断规则来源
2. **缓存机制**: 为 AdGuard 过滤器下载添加缓存
3. **更多过滤器支持**: 支持其他格式的过滤器（如 EasyList）
4. **统计功能**: 添加更详细的统计和分析功能
5. **CI 集成**: 在 GitHub Actions 中自动检查新增规则的 TLD 合法性

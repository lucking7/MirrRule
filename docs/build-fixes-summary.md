# 构建系统修复总结

## 修复的问题

### 1. 混合规则集 TLD 验证

**问题**: 混合规则集不应进行 TLD 验证，因为它们包含各种规则类型，不仅仅是域名。

**修复**:

- 在 `validate-illegal-tld.ts` 中，混合规则集（RulesetType.RULESET）现在会跳过 TLD 验证
- 只有纯域名规则集（RulesetType.DOMAINSET）才会进行 TLD 验证

### 2. cdn.list 和 direct.list 分类

**问题**: cdn.list 和 direct.list 应该被识别为混合规则集，使用 RulesetOutput。

**修复**:

- 在 `RulesetClassifier` 中添加了特殊处理逻辑
- 这两个文件会被强制分类为混合规则集，无论内容如何

### 3. Source 目录不存在的错误

**问题**: 构建系统期望 Source/domainset 和 Source/non_ip 目录存在，但它们可能不存在。

**修复**:

- `validate-domain-alive.ts`: 改为扫描实际存在的规则目录（Surge/Rulesets, Chores/ruleset）
- `validate-hash-collision.ts`: 同样改为扫描实际存在的目录
- `build-common.ts`: 添加了目录存在性检查，不存在时优雅跳过

### 4. 域名活性验证

**问题**: 域名活性验证不应该自动运行，而应该手动触发。

**修复**:

- 在 `validate-all-rules.ts` 中，域名活性检测现在只是打印提示信息
- 用户需要手动运行 `npm run validate:domain-alive` 来执行实际检测

## 技术细节

### 优化策略对比

| 功能          | DomainsetOutput | RulesetOutput |
| ------------- | --------------- | ------------- |
| tldts 规范化  | ✅ 完整应用     | ❌ 不应用     |
| Trie 深度优化 | ✅ 完整应用     | ✅ 基础应用   |
| CIDR 合并     | ❌ 不适用       | ✅ 支持 IPv4  |
| TLD 验证      | ✅ 需要         | ❌ 不需要     |

### 验证工具对比

| 工具           | 自动运行 | 手动运行 | 说明                   |
| -------------- | -------- | -------- | ---------------------- |
| 规则语法验证   | ✅       |          | 快速，每次构建都运行   |
| TLD 合法性检测 | ✅       |          | 快速，但跳过混合规则集 |
| 哈希碰撞检测   | ✅       |          | 使用 xxhash-wasm       |
| 域名活性检测   |          | ✅       | 耗时较长，需要网络请求 |

## 测试命令

```bash
# 测试分类器
npm run test:classifier

# 测试特定规则集
npm run test:ruleset cdn.list

# 手动运行域名活性检测
npm run validate:domain-alive

# 测试修复
NODE_OPTIONS="--experimental-specifier-resolution=node" tsx Chores/engineering/scripts/test-build-fixes.ts
```

## 结论

所有报告的问题都已修复：

1. ✅ 混合规则集不再进行 TLD 验证
2. ✅ cdn.list 和 direct.list 正确识别为混合规则集
3. ✅ Source 目录不存在时不会报错
4. ✅ 域名活性验证改为手动触发

# Reject 规则优化策略说明

## 规则类型区分

根据系统设计，不同类型的规则有不同的处理策略：

### DomainsetOutput

- **用途**：纯域名规则集，如 CDN、社交媒体等分类域名
- **tldts 规范化**：✅ 完整处理
- **Trie 深度优化**：✅ 包含关系合并
- **示例文件**：`cdn.list`, `social.list`

### RulesetOutput

- **用途**：混合规则集，包含域名、IP、关键词等多种规则类型
- **tldts 规范化**：❌ 不处理
- **Trie 深度优化**：⚠️ 仅基础去重
- **示例文件**：`reject/block.list`, `reject-drop.list`

## Reject 规则特殊性

Reject 规则（如 `block.list`）属于 RulesetOutput 类型，不应进行 tldts 规范化，原因如下：

1. **保持原始格式**

   - 某些广告拦截规则可能包含特殊格式的域名
   - 例如：`*.cn`、`118.89.204.198` 等
   - 这些在技术上可能不是"有效"的域名，但在广告拦截场景下是必要的

2. **兼容性考虑**

   - 规则来源多样（AdGuard、EasyList、自定义规则等）
   - 不同源的规则格式可能不同
   - 过度规范化可能导致规则失效

3. **性能优化**
   - RulesetOutput 主要优化 IP CIDR 合并
   - 域名部分只进行基础去重，避免破坏特殊规则

## 优化配置

在 sync 阶段优化 reject 规则时，应使用以下配置：

```typescript
await rejectOptimizer.optimizeRejectRules(config.repoPath, {
  enableTldValidation: false, // 不进行 TLD 验证
  enableDomainMerge: true, // 启用域名合并（Trie 去重）
  enableWhitelist: true, // 启用白名单过滤
  whitelistDomains, // 白名单域名列表
});
```

## 优化效果

即使不进行 TLD 验证，优化器仍然可以：

- ✅ 移除重复规则
- ✅ 合并父子域名关系
- ✅ 应用白名单过滤
- ✅ 优化 IP CIDR 段
- ✅ 保持规则的完整性和兼容性

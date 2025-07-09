# 统一 Reject 规则处理说明

## 概述

Reject 规则的处理已经从两个独立的流程统一到一个集成化的构建流程中。

## 之前的问题

1. **sync 阶段**：从 `rule-sources.ts` 定义的源合并规则
2. **build 阶段**：从 AdGuard 过滤器生成规则，**覆盖**第一步的结果
3. 导致部分规则源（ConnersHua、TG-Twilight 等）被丢失

## 当前解决方案

### 1. 统一数据源

所有 reject 数据源现在都在 `build-reject-domainset.ts` 中统一处理：

```typescript
// AdGuard 过滤器
- AdGuard Base Filter
- EasyPrivacy
- AdGuard Chinese filter

// 其他规则源（来自原 rule-sources.ts）
- ConnersHua RuleGo (Advertising, Malicious, Tracking)
- TG-Twilight AWAvenue-Ads-Rule
- anti-AD (可选)
- Cats-Team AdRules (可选)
```

### 2. 处理流程

1. **读取本地规则**（如果存在）
2. **并行下载所有数据源**
3. **统一解析和验证**
   - TLD 合法性检查
   - 白名单过滤
4. **Trie 结构优化**
   - 自动去重
   - 父子域合并
5. **输出到 `block.list`**

### 3. 工作流调整

- `sync` 阶段：不再处理 Reject 合并（已注释掉）
- `optimize-reject` 阶段：跳过（由 build:reject 处理）
- `build:reject` 阶段：执行统一的规则构建

### 4. 优势

- ✅ 所有数据源统一处理，不会丢失
- ✅ 避免文件覆盖问题
- ✅ 更高效的去重和优化
- ✅ 统一的白名单机制
- ✅ 详细的统计信息

## 测试验证

运行测试脚本验证：

```bash
cd Chores/engineering
npx tsx build/scripts/test-unified-reject.ts
```

预期结果：

- 所有数据源标记都显示 ✓
- 规则数量符合预期
- 已知广告域名被正确包含

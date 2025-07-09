# Reject 域名集构建系统总结

## 🆕 2024 年最新更新

### 统一输出策略

- **改进前**：分级输出到三个文件（block.list、block_extra.list、phishing.list）
- **改进后**：所有规则统一输出到单一 `block.list` 文件
- **优势**：简化配置管理，避免用户混淆，提供完整保护

### 完整功能整合

- 移除了基础版和增强版的区分
- 所有功能都集成到标准的 `build:reject` 命令中
- 保持了原有的所有高级功能和数据源

## 📊 系统特性

### 1. 数据源整合 ✅

**之前的问题**：

- sync 阶段和 build 阶段各自处理不同数据源
- build-reject-domainset.ts 会覆盖 sync 阶段的结果
- 数据源不完整

**增强版改进**：

```typescript
// 完整数据源整合
- HOSTS 文件（GoodbyeAds）
- HOSTS_EXTRA（pgl.yoyo.org, someonewhocares.org）
- DOMAIN_LISTS_EXTRA（AdGuard CNAME trackers, URLhaus）
- PHISHING 源（Phishing.army, Durablenapkin）
- AdGuard 过滤器（Base, EasyPrivacy, Tracking Protection, Chinese）
- Surge 规则（ConnersHua, TG-Twilight）
```

### 2. 分层处理逻辑 ✅

| 数据源类型         | 规范化方式          | Trie 去重 | 格式验证    | 实际实现                          |
| ------------------ | ------------------- | --------- | ----------- | --------------------------------- |
| **HOSTS 文件**     | ✅ 轻量级（去 www） | ✅ 标准   | ✅ 自动     | `fastNormalizeDomainWithoutWww()` |
| **域名列表**       | ✅ 完整规范化       | ✅ 标准   | ✅ 严格     | `fastNormalizeDomain()`           |
| **AdGuard 过滤器** | ✅ 宽松验证         | ✅ 标准   | ✅ 简化解析 | 手动解析 + tldts 验证             |
| **Surge 规则**     | ❌ 保持原样         | ✅ 基础   | ✅ TLD 验证 | 仅验证，不变换                    |

### 3. 分级输出 ✅

**增强版输出结构**：

```
Surge/Rulesets/reject/
├── block.list         # 主规则（高置信度）- 91,157 条
├── block_extra.list   # 额外规则（低置信度）- 80,403 条
└── phishing.list      # 钓鱼域名（威胁情报）- 113,664 条
```

### 4. 白名单机制 ✅

**多层白名单保护**：

1. **预定义白名单**（PREDEFINED_WHITELIST）

   - 崩溃报告服务（Sentry、Bugsnag、Crashlytics）
   - 重要服务（login.microsoftonline.com、api.xiaomi.com）
   - 本地域名（localhost、local）

2. **AdGuard 白名单过滤器**

   - exceptions.txt
   - exclusions.txt
   - unbreak.min.txt

3. **自动白名单应用**
   - 所有 Trie 树都应用白名单
   - 防止误杀重要服务

### 5. 优化机制 ✅

- **Trie 结构去重**：自动合并父子域关系
- **IP CIDR 合并**：使用 fast-cidr-tools 优化
- **关键词过滤**：retrie 算法高效匹配

## 📈 处理结果对比

| 指标           | 基础版                    | 增强版               |
| -------------- | ------------------------- | -------------------- |
| **数据源数量** | 3 个 AdGuard + 4 个 Surge | 20+ 个多种类型数据源 |
| **处理域名数** | ~131,627                  | ~600,000+            |
| **最终规则数** | 65,873（单文件）          | 285,224（三个文件）  |
| **分类输出**   | ❌ 否                     | ✅ 主/额外/钓鱼      |
| **规范化策略** | ❌ 统一处理               | ✅ 分层处理          |
| **白名单保护** | ⚠️ 基础                   | ✅ 多层保护          |

## 🔧 技术亮点

1. **模块化设计**

   - 独立的处理函数：`processHosts()`, `processDomainList()`, `processAdGuardFilter()`
   - 清晰的数据流转

2. **容错处理**

   - 单个数据源失败不影响整体
   - 详细的错误日志

3. **性能优化**

   - 并行处理多个数据源
   - 流式解析大文件

4. **可扩展性**
   - 易于添加新数据源
   - 支持自定义处理逻辑

## 🚀 使用方式

```bash
# 基础版（快速构建）
npm run build:reject

# 增强版（完整功能）
npm run build:reject:enhanced
```

## 📝 后续改进建议

1. **添加缺失的数据源**

   - HOSTS 类：anti-AD、jdlingyu ad-wars
   - AdGuard Extra 过滤器
   - 钓鱼评分机制

2. **增强解析能力**

   - 使用 @ghostery/adblocker 完整解析
   - 支持更多规则类型（DOMAIN-WILDCARD、URL-REGEX）

3. **活性检测集成**

   - 集成域名活性检测
   - 定期清理失效域名

4. **调试追踪**
   - 添加 onBlackFound/onWhiteFound 追踪
   - 生成详细的处理报告

## 总结

增强版成功实现了参考 surge-master-2 的完整功能，包括：

- ✅ 多源数据聚合
- ✅ 分层处理逻辑
- ✅ 智能去重优化
- ✅ 分级输出策略
- ✅ 完善的白名单保护

这为 esdeath 项目提供了一个功能完整、可扩展的 reject 规则构建系统。

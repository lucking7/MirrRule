# 规则优化功能总结

## 概述

esdeath 项目已成功实现了完整的规则优化功能，包括：

1. **Trie 树域名合并** - 使用自定义的 `HostnameSmolTrie` 实现
2. **IP 段优化** - 使用 `fast-cidr-tools` 合并相邻 IP 段
3. **增强的 TLD 验证** - 支持不同数据源的差异化验证策略
4. **Reject 规则优化** - 包含白名单、TLD 验证和域名去重

## 主要功能

### 1. 域名优化 (Trie 树合并)

- **实现位置**: `Chores/engineering/lib/trie.ts`
- **功能特点**:
  - 自动识别并合并冗余的域名规则
  - 支持 `DOMAIN` 和 `DOMAIN-SUFFIX` 规则
  - 例如：同时存在 `a.example.com` 和 `.example.com` 时，只保留后者

### 2. IP 段优化

- **使用工具**: `fast-cidr-tools`
- **功能特点**:
  - 自动合并相邻或重叠的 IP 段
  - 支持 IPv4 和 IPv6
  - 显著减少 IP 规则数量

### 3. TLD 验证

- **实现位置**: `Chores/engineering/lib/enhanced-tld-validator.ts`
- **验证策略**:
  - **宽松模式** (本地文件、Hosts、域名列表): 接受私有后缀
  - **严格模式** (AdGuard 过滤器): 只接受 ICANN 认证的 TLD
  - 包含 ICP 备案 TLD 白名单
  - 特殊用途 TLD 支持 (如 localhost、lan 等)

### 4. Reject 规则优化

- **实现位置**: `Chores/engineering/sync/reject-optimizer.ts`
- **功能特点**:
  - 自动移除无效 TLD 的域名
  - 基于白名单过滤合法域名
  - 使用 Trie 树进行域名去重和合并
  - 生成详细的优化报告

## 工作流集成

### Main 工作流执行顺序

1. **同步规则源** (仅在定时任务或手动触发时)
2. **转换规则** (Loon → Surge, QX → Surge)
3. **处理和增强模块**
4. **合并 Surge 模块**
5. **优化规则集** (新增，在验证之前)
   - IP 段优化
   - 域名规则优化
   - Reject 规则优化
6. **验证规则集**
   - 规则语法验证
   - 非法 TLD 检测
   - Reject 规则 TLD 合法性检查
7. **提交更改**

### 优化统计

工作流会在以下位置显示优化统计：

1. **控制台输出**: 实时显示优化进度和结果
2. **提交信息**: 包含优化统计，如 `[IP优化: -100] [域名优化: -200]`
3. **构建报告**: 在 GitHub Actions Summary 中显示详细统计

## 配置选项

### Reject 优化器配置

```typescript
interface RejectOptimizationOptions {
  enableTldValidation?: boolean; // 启用 TLD 验证
  enableDomainMerge?: boolean; // 启用域名合并
  enableWhitelist?: boolean; // 启用白名单
  whitelistDomains?: string[]; // 白名单域名列表
}
```

### 白名单域名

项目包含了常见的合法域名白名单，包括：

- 国际主流网站 (Google, Facebook, Twitter 等)
- 中国主流网站 (百度、淘宝、微博等)
- CDN 和云服务提供商
- 开发相关网站 (GitHub, npm, Docker 等)

## 文件排除列表

以下文件不会进行优化（避免破坏特殊规则集）：

- domestic.list
- global.list
- reject.list
- telegram.list
- direct.list
- cdn.list
- stream.list
- microsoft.list
- lan.list
- apple.list

## 使用方法

### 自动执行

规则优化会在以下情况自动执行：

- 每 3 小时的定时任务
- 手动触发工作流
- Push 到 main 分支

### 手动测试

```bash
# 测试 Reject 优化器
cd Chores/engineering
npx tsx sync/test-reject-optimizer.ts

# 运行完整的同步流程（包含优化）
npm run sync
```

## 优化效果

典型的优化效果：

- **IP 段优化**: 减少 10-30% 的 IP 规则
- **域名优化**: 减少 5-20% 的域名规则
- **Reject 优化**: 移除无效 TLD，合并冗余域名

## 注意事项

1. 优化过程会直接修改原文件，建议先备份
2. 某些特殊规则集被排除在优化之外，以保持其原始状态
3. TLD 验证使用不同的策略，确保不会误删合法域名
4. 白名单机制可以保护重要域名不被优化掉

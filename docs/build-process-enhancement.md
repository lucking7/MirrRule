# Esdeath 规则集构建流程增强

## 概述

本次更新严格遵循提出的流程图，对 GitHub Actions 和项目构建脚本进行了全面改进，实现了智能化的规则集分类和处理。

## 主要改进

### 1. 规则集分类器 (RulesetClassifier)

创建了 `Chores/engineering/build/lib/ruleset-classifier.ts`，实现了智能规则集分类：

- **自动分类**：通过分析规则内容，自动判定规则集类型
- **三种类型**：
  - 纯域名规则集（95%以上是域名规则）
  - 纯 IP 规则集（95%以上是 IP 规则）
  - 混合规则集（其他情况）
- **置信度评分**：提供分类结果的可信度

### 2. 混合规则集构建优化

更新了 `build-mixed-ruleset.ts`，实现智能处理：

- **类型判定**：使用 RulesetClassifier 分析每个规则集
- **差异化处理**：
  - 纯域名规则集 → DomainsetOutput（启用 tldts 规范化）
  - 纯 IP 规则集 → RulesetOutput（进行 CIDR 合并）
  - 混合规则集 → RulesetOutput（不进行域名规范化）
- **进度显示**：显示规则集类型和处理进度

### 3. GitHub Actions 流程重构

完全重构了 `.github/workflows/main.yml`，严格按照 8 个阶段执行：

#### 第一阶段：外部规则和模块获取

- 同步外部规则源 (`npm run sync:rules`)
- 同步外部模块 (`npm run sync:mirror`)

#### 第二阶段：源文件组织

- 处理和增强 Surge 模块
- 合并模块文件
- 检查规则文件组织结构

#### 第三阶段：构建脚本执行

- 执行主构建脚本 (`build/index.ts`)
- 包含 5 个子步骤：预验证、构建、优化、后验证、报告

#### 第四阶段：规则处理流程

- 使用 RulesetClassifier 分析规则集类型
- 显示不同类型的处理策略

#### 第五阶段：优化处理

- tldts 规范化（纯域名规则集）
- Trie 深度优化（去除冗余子域名）
- CIDR 合并（IP 规则集）

#### 第六阶段：验证检测

- 规则语法验证
- TLD 合法性检测
- 哈希碰撞检测（集成在构建中）
- 域名活性检测（定时任务）

#### 第七阶段：文件输出

- 多格式支持（Surge、AdGuardHome、Clash）
- 规范的输出目录结构

#### 第八阶段：部署分发

- Git 自动提交
- GitHub Pages 部署
- 详细的构建报告

### 4. 构建报告增强

重新设计了构建报告格式：

- **流程执行状态表**：显示 8 个阶段的执行情况
- **规则集分类说明**：明确不同类型的处理方式
- **优化技术说明**：列出所有使用的优化技术
- **技术栈展示**：显示项目使用的核心技术

## 技术实现细节

### 规则类型判定逻辑

```typescript
// IP 规则判定
if (upperLine.includes('IP-CIDR') || upperLine.includes('IP-ASN') || upperLine.includes('GEOIP')) {
  stats.ips++;
}

// 域名规则判定
else if (
  upperLine.includes('DOMAIN') ||
  upperLine.includes('HOST') ||
  upperLine.includes('URL-REGEX')
) {
  stats.domains++;
}

// 基于比例判定类型
if (domainRatio >= 0.95) {
  type = RulesetType.DOMAIN;
} else if (ipRatio >= 0.95) {
  type = RulesetType.IP;
} else {
  type = RulesetType.MIXED;
}
```

### 处理器选择策略

- **DomainsetOutput**：

  - 用于纯域名规则集
  - 启用 tldts 规范化
  - 使用 Trie 数据结构优化

- **RulesetOutput**：
  - 用于混合规则集和 IP 规则集
  - 支持所有规则类型
  - IP 规则集会进行 CIDR 合并

## 使用效果

1. **更智能**：自动识别规则集类型，选择最优处理方式
2. **更高效**：差异化处理减少不必要的计算
3. **更清晰**：8 阶段流程一目了然，便于调试和维护
4. **更规范**：严格遵循流程图，确保构建质量

## 后续优化建议

1. 实现专门的 IPListOutput 类，更好地处理纯 IP 规则集
2. 增加规则集类型的缓存，避免重复分析
3. 支持自定义分类阈值（当前固定为 95%）
4. 增加更多输出格式支持

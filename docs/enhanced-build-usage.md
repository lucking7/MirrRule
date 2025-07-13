# Esdeath 增强构建系统使用指南

## 快速开始

### 扫描规则集目录结构

```bash
npm run scan:rulesets
```

### 测试规则集分类器

```bash
npm run test:classifier
```

### 测试特定规则集

```bash
# 测试默认文件（cn-max_bm7.list）
npm run test:ruleset

# 测试指定文件
npm run test:ruleset Surge/Rulesets/reject/adtago.list
```

### 运行完整构建流程

```bash
npm run build
```

### 分步执行

```bash
# 第一阶段：同步外部资源
npm run sync:rules   # 同步规则源
npm run sync:mirror  # 同步模块

# 第二阶段：处理模块
npm run process:modules  # 处理和增强模块
npm run merge           # 合并模块

# 第三阶段：构建
npm run build           # 执行完整构建
```

## 规则集类型判定

系统会自动判定规则集类型并选择最优处理方式：

### 纯域名规则集（DOMAIN-SET 格式，≥95% 纯域名行）

- 每行只有域名或 IP，无规则类型前缀
- 格式示例：
  ```
  example.com
  .facebook.com    # 点开头匹配域名及所有子域
  192.168.1.1
  ```
- 使用 `DomainsetOutput` 处理
- 启用 tldts 规范化
- 使用 Trie 数据结构优化

### 纯 IP 规则集（≥95% IP 规则）

- 包含 `IP-CIDR`、`IP-CIDR6`、`GEOIP`、`IP-ASN` 规则
- 格式示例：
  ```
  IP-CIDR,192.168.0.0/16,DIRECT
  GEOIP,CN,DIRECT
  IP-ASN,13335,PROXY
  ```
- 使用 `RulesetOutput` 处理
- 进行 CIDR 合并优化

### 混合规则集（其他情况）

- 包含 `DOMAIN`、`DOMAIN-SUFFIX` 等前缀格式
- 格式示例：
  ```
  DOMAIN,example.com
  DOMAIN-SUFFIX,google.com
  IP-CIDR,192.168.0.0/16,DIRECT
  ```
- 使用 `RulesetOutput` 处理
- 不进行域名规范化
- 保留所有规则类型
- **绝大多数 Surge 规则集都是这种格式**

## GitHub Actions 工作流

### 定时执行（每 3 小时）

```yaml
schedule:
  - cron: '0 */3 * * *'
```

### 手动触发

在 GitHub 仓库的 Actions 页面，选择 "Main Build Pipeline"，点击 "Run workflow"。

### 查看构建报告

每次构建完成后，在 Actions 的 Summary 页面可以看到详细的构建报告，包括：

- 8 个阶段的执行状态
- 规则集分类结果
- 优化技术说明
- 构建统计信息

## 优化功能说明

### 1. tldts 规范化

- 仅对纯域名规则集启用
- 提取有效域名，去除无效子域
- 例：`sub.example.com` → `example.com`

### 2. Trie 深度优化

- 自动去除冗余子域名
- 如果已有 `example.com`，则移除 `*.example.com`

### 3. CIDR 合并

- 对 IP 规则集进行智能合并
- 例：`192.168.1.0/24` + `192.168.2.0/24` → `192.168.0.0/23`

### 4. 并行处理

- 多个规则集同时构建
- 显著提升构建效率

## 验证功能

### 规则语法验证

```bash
npm run validate:rulesyntax
```

### TLD 合法性检测

```bash
npm run validate:tld
```

### 域名活性检测

```bash
npm run validate:domain-alive
```

### 哈希碰撞检测

```bash
npm run validate:hash
```

## 故障排除

### 构建失败

1. 检查 Actions 日志中的错误信息
2. 确认外部规则源是否可访问
3. 运行 `npm run validate:all` 检查规则格式

### 分类器问题

1. 运行 `npm run test:classifier` 测试分类器
2. 检查规则文件格式是否标准
3. 查看分类置信度是否过低

### 性能问题

1. 检查是否有超大规则集
2. 确认服务器资源是否充足
3. 考虑调整并发数

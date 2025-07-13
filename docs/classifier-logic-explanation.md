# 规则集分类器逻辑说明

## 关键修正：混合规则集的正确识别

### 问题

`domestic/cn-max_bm7.list` 被错误地判定为纯域名规则集，但实际上它包含：

- DOMAIN-SUFFIX 规则（带前缀）
- IP-CIDR 规则
- USER-AGENT 规则
- PROCESS-NAME 规则
- 等等

### 解决方案

修改了分类逻辑，现在：

```typescript
// 如果有任何"其他"类型的规则，就是混合规则集
if (stats.other > 0) {
  type = RulesetType.MIXED;
}
```

## 分类逻辑详解

### 1. 纯域名规则集 (DOMAIN-SET)

**条件**：

- 95%以上的行是纯域名格式（无前缀）
- **且** `stats.other === 0`（没有任何带前缀的规则）

**格式示例**：

```
example.com
.facebook.com
192.168.1.1
```

### 2. 纯 IP 规则集

**条件**：

- 95%以上的行是 IP 规则
- **且** `stats.other === 0`（没有域名规则或其他规则）

**格式示例**：

```
IP-CIDR,192.168.0.0/16,DIRECT
IP-CIDR6,2001:db8::/32,DIRECT
GEOIP,CN,DIRECT
IP-ASN,13335,PROXY
```

### 3. 混合规则集

**条件**（满足任一）：

- 包含任何"其他"类型的规则（`stats.other > 0`）
- 不满足纯域名或纯 IP 的条件

**"其他"类型包括**：

- `DOMAIN,xxx`
- `DOMAIN-SUFFIX,xxx`
- `DOMAIN-KEYWORD,xxx`
- `USER-AGENT,xxx`
- `PROCESS-NAME,xxx`
- `URL-REGEX,xxx`
- 等等

## 测试命令

```bash
# 测试特定文件
npm run test:ruleset Surge/Rulesets/domestic/cn-max_bm7.list

# 扫描所有规则集
npm run scan:rulesets

# 运行完整测试
npm run test:classifier
```

## 为什么这样设计？

1. **Surge 规则集的实际情况**：

   - 绝大多数 Surge 规则集都使用带前缀的格式（DOMAIN-SUFFIX 等）
   - 纯域名格式（DOMAIN-SET）是特殊情况，较少使用

2. **准确性优先**：

   - 宁可将纯域名规则集误判为混合，也不要将混合规则集误判为纯域名
   - 混合规则集使用 RulesetOutput 处理更安全

3. **优化策略**：
   - 纯域名规则集：启用 tldts 规范化
   - 混合规则集：不进行域名规范化，避免破坏规则语义

# 规则集分类修正说明

## 修正内容

### 1. 纯域名规则集 (DOMAIN-SET) 的正确识别

之前的实现错误地将 `DOMAIN`、`DOMAIN-SUFFIX` 等格式识别为纯域名规则集。实际上：

#### ❌ 错误理解

```
DOMAIN,example.com
DOMAIN-SUFFIX,google.com
DOMAIN-KEYWORD,facebook
```

这些是**混合规则集**格式，不是纯域名规则集。

#### ✅ 正确的纯域名规则集 (DOMAIN-SET)

```
# 每行只有域名或IP，没有规则类型前缀
example.com
google.com
.facebook.com    # 点开头表示匹配域名及所有子域
twitter.com
192.168.1.1      # 也支持IP地址
```

### 2. IP 规则集的正确识别

IP 规则集包含以下格式：

- `IP-CIDR,192.168.0.0/16,策略`
- `IP-CIDR6,2001:db8::/32,策略`
- `GEOIP,CN,策略`
- `IP-ASN,13335,策略`

可选参数 `no-resolve` 用于跳过域名解析。

### 3. 递归扫描支持

- 之前只扫描 `Surge/Rulesets` 根目录
- 现在递归扫描所有子目录（如 `reject/`、`stream/` 等）
- 使用相对路径显示文件位置

## 分类逻辑

### 判定流程

1. **纯域名规则集** (≥95% 是纯域名行)

   - 每行只有域名或 `.域名`
   - 没有 `DOMAIN,`、`DOMAIN-SUFFIX,` 等前缀
   - 使用 `DomainsetOutput` 处理，启用 tldts 规范化

2. **纯 IP 规则集** (≥95% 是 IP 规则)

   - 包含 `IP-CIDR`、`GEOIP`、`IP-ASN` 等
   - 使用 `RulesetOutput` 处理，进行 CIDR 合并

3. **混合规则集** (其他情况)
   - 包含多种规则类型
   - 使用 `RulesetOutput` 处理，不进行域名规范化

### 正则表达式

```typescript
// 纯域名（不含前缀）
/^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/

// 点开头的域名
/^\.[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$/

// IPv4
/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/

// IPv6
/^[a-fA-F0-9:]+$/
```

## 使用效果

运行 `npm run test:classifier` 后：

```
🔀 混合规则集 (7个):
  - aigc.list
  - cdn.list
  - direct.list
  - domestic.list
  - global.list
  - reject.list
  - telegram.list
```

这些文件都被正确识别为混合规则集，因为它们使用了 `DOMAIN,`、`DOMAIN-SUFFIX,` 等前缀格式。

## 测试

测试脚本会创建各种类型的测试文件：

1. **domain-only.list** - 纯域名规则集（DOMAIN-SET 格式）
2. **mixed-domain.list** - 混合域名规则集（Surge 格式）
3. **ip-only.list** - 纯 IP 规则集
4. **mixed.list** - 完全混合规则集
5. **boundary.list** - 边界情况（94% 域名）

通过这些测试确保分类器能正确识别不同类型的规则集。

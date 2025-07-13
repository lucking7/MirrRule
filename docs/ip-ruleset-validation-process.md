# IP 规则集验证和优化流程

## 概述

纯 IP 规则集的处理不仅仅是 CIDR 合并优化，还包含完整的验证、去重、分类和优化流程。

## 完整处理流程

### 第一阶段：规则解析和分类

```typescript
// 来自 FileOutput.addFromRuleset
case 'IP-CIDR':
  (arg === 'no-resolve' ? this.ipcidrNoResolve : this.ipcidr).add(value);
  break;
case 'IP-CIDR6':
  (arg === 'no-resolve' ? this.ipcidr6NoResolve : this.ipcidr6).add(value);
  break;
case 'IP-ASN':
  (arg === 'no-resolve' ? this.ipasnNoResolve : this.ipasn).add(value);
  break;
case 'GEOIP':
  (arg === 'no-resolve' ? this.geoipNoResolve : this.geoip).add(value);
  break;
```

规则被分类存储到不同的 Set 中：

- IPv4 CIDR（有无 no-resolve）
- IPv6 CIDR（有无 no-resolve）
- ASN 规则
- GeoIP 规则

### 第二阶段：格式验证

#### 1. IP-CIDR 格式验证（`ip-validator.ts`）

```typescript
export function isValidIPv4CIDR(cidr: string): boolean {
  // 分割为IP和前缀
  const [ip, prefix] = cidr.split('/');

  // 验证前缀范围 (0-32)
  const prefixNum = parseInt(prefix, 10);
  if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
    return false;
  }

  // 验证IP格式 (xxx.xxx.xxx.xxx)
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return false;
    }
  }
  return true;
}
```

#### 2. IP-CIDR6 格式验证

```typescript
export function isValidIPv6CIDR(cidr: string): boolean {
  const [ip, prefix] = cidr.split('/');

  // 验证前缀范围 (0-128)
  const prefixNum = parseInt(prefix, 10);
  if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 128) {
    return false;
  }

  // 使用正则验证 IPv6 格式
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|...)$/;
  return ipv6Regex.test(ip);
}
```

#### 3. ASN 和 GeoIP 验证

```typescript
// ASN 验证：必须是纯数字
function validateASN(value: string): boolean {
  return /^\d+$/.test(value);
}

// GeoIP 验证：2字母国家代码
function validateCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value.toUpperCase());
}
```

### 第三阶段：IP 地址标准化

```typescript
// 单个 IP 自动转换为 CIDR
static readonly ipToCidr = (ip: string, version: 4 | 6) => {
  if (ip.includes('/')) return ip;
  return version === 4 ? ip + '/32' : ip + '/128';
};
```

### 第四阶段：去重处理

使用 Set 数据结构自动去重：

```typescript
protected ipcidr = new Set<string>();
protected ipcidr6 = new Set<string>();
```

### 第五阶段：CIDR 合并优化

在 `writeToStrategies` 方法中进行：

```typescript
// 使用 fast-cidr-tools 进行合并
if (this.ipcidr.size) {
  ipcidr = mergeCidr(Array.from(this.ipcidr));
}
if (this.ipcidr6.size) {
  ipcidr6 = Array.from(this.ipcidr6); // IPv6 暂不合并
}
```

#### CIDR 合并原理

```
输入：
192.168.0.0/24
192.168.1.0/24
192.168.2.0/24
192.168.3.0/24

输出：
192.168.0.0/22  # 合并为更大的网段
```

### 第六阶段：规则分组输出

按照 Surge 格式要求的顺序输出：

```typescript
// 1. 先输出 no-resolve 规则
if (ipcidrNoResolve) {
  strategy.writeIpCidrs(ipcidrNoResolve, true);
}
if (ipcidr6NoResolve) {
  strategy.writeIpCidr6s(ipcidr6NoResolve, true);
}
if (this.ipasnNoResolve.size) {
  strategy.writeIpAsns(this.ipasnNoResolve, true);
}
if (this.geoipNoResolve.size) {
  strategy.writeGeoip(this.geoipNoResolve, true);
}

// 2. 再输出普通规则
if (ipcidr) {
  strategy.writeIpCidrs(ipcidr, false);
}
// ... 其他规则类型
```

## 验证脚本

### validate-ip-rules.ts

专门验证 IP 规则的脚本，功能包括：

1. **扫描所有规则文件**
2. **提取 IP 规则**
3. **验证格式正确性**
4. **输出无效规则报告**
5. **可选自动修复**（`--fix` 参数）

### 使用方法

```bash
# 验证 IP 规则
npm run validate:ip-rules

# 自动移除无效规则
npm run validate:ip-rules -- --fix
```

## 优化效果示例

### CIDR 合并前

```
IP-CIDR,1.0.1.0/24,no-resolve
IP-CIDR,1.0.2.0/23,no-resolve
IP-CIDR,1.0.8.0/21,no-resolve
IP-CIDR,1.0.32.0/19,no-resolve
# 8111 条规则
```

### CIDR 合并后

```
IP-CIDR,1.0.0.0/21,no-resolve
IP-CIDR,1.0.32.0/19,no-resolve
# 约 3000 条规则（减少 60%+）
```

## IPListOutput 类（专用处理器）

虽然当前使用 `RulesetOutput` 处理 IP 规则集，但项目中已有专门的 `IPListOutput` 类设计：

```typescript
export class IPListOutput extends FileOutput {
  private readonly ipv4Set = new Set<string>();
  private readonly ipv6Set = new Set<string>();
  private readonly geoipSet = new Set<string>();
  private readonly asnSet = new Set<string>();

  // 智能添加 CIDR
  addCIDR(cidr: string): this {
    const version = ipversion(cidr);
    if (version === 4) {
      this.ipv4Set.add(cidr);
    } else if (version === 6) {
      this.ipv6Set.add(cidr);
    } else {
      console.warn(`⚠️ 无效的 CIDR: ${cidr}`);
    }
    return this;
  }

  // 优化处理
  private optimizeCIDRs(): { ipv4: string[]; ipv6: string[] } {
    const mergedIPv4 = mergeCidr(Array.from(this.ipv4Set));
    const mergedIPv6 = mergeCidr(Array.from(this.ipv6Set));

    console.log(`IPv4 优化: ${this.ipv4Set.size} → ${mergedIPv4.length}`);
    console.log(`IPv6 优化: ${this.ipv6Set.size} → ${mergedIPv6.length}`);

    return { ipv4: mergedIPv4, ipv6: mergedIPv6 };
  }
}
```

## 总结

纯 IP 规则集的处理是一个完整的流水线：

1. **解析分类** - 识别不同类型的 IP 规则
2. **格式验证** - 确保 CIDR、ASN、国家代码格式正确
3. **标准化** - 单个 IP 转换为 /32 或 /128
4. **去重** - 使用 Set 自动去重
5. **CIDR 合并** - 相邻网段自动合并
6. **分组输出** - 按 no-resolve 和普通规则分组

这确保了输出的 IP 规则集不仅格式正确，而且经过了充分的优化，减少了规则数量，提高了匹配效率。

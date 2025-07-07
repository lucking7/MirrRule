# AdGuard 规则到代理软件格式转换详解

## 1. 合并流程概述

是的，reject 规则文件是多个数据源合并而来的：

### 数据源类型

1. **本地规则文件**：`Source/domainset/reject.conf`、`Source/domainset/reject_extra.conf`
2. **远程 Hosts 文件**：如 StevenBlack hosts
3. **远程域名列表**：如 AdGuard CNAME trackers
4. **AdGuard 过滤器**：如 EasyList、EasyPrivacy

### 验证策略差异

- **本地文件 + Hosts + 域名列表**：宽松验证（接受私有后缀）
- **AdGuard 过滤器**：严格验证（只接受 ICANN TLD）

## 2. AdGuard 规则解析

### AdGuard 规则格式示例

```
||example.com^
||ads.*.example.com^
@@||whitelist.com^
||tracker.com^$third-party
```

### 解析过程

```typescript
// lib/parse-filter/filters.ts
// 1. 预过滤不支持的规则
export class AdGuardFilterIgnoreUnsupportedLinesStream extends TransformStream<string, string> {
  transform(line, controller) {
    // 过滤掉 Surge/Clash 不支持的修饰符
    if (kwfilter(line)) return; // $popup, $redirect 等

    // 过滤掉路径规则
    if ((line.includes('/') || line.includes(':')) && !line.includes('://')) {
      return;
    }

    controller.enqueue(line);
  }
}

// 2. 解析规则提取域名
function parse(line: string) {
  // 移除 || 和 ^ 等符号
  // ||example.com^ -> example.com
  // @@||whitelist.com^ -> whitelist.com (标记为白名单)
  // 处理修饰符
  // ||tracker.com^$third-party -> tracker.com (可能跳过)
}
```

## 3. 统一数据结构

所有解析后的数据存储在 `FileOutput` 类中：

```typescript
export class FileOutput {
  // 域名存储
  public domainTrie = new HostnameSmolTrie(null); // 精确域名
  public wildcardTrie = new HostnameSmolTrie(null); // 通配符域名
  protected domainKeywords = new Set<string>(); // 关键词

  // IP 规则存储
  protected ipcidr = new Set<string>(); // IP 段
  protected ipcidr6 = new Set<string>(); // IPv6 段

  // 其他规则
  protected urlRegex = new Set<string>(); // URL 正则
  protected processName = new Set<string>(); // 进程名
  // ...
}
```

## 4. 格式转换（策略模式）

不同代理软件使用不同的 `WriteStrategy` 实现：

### Surge 格式

```typescript
// lib/writing-strategy/surge.ts
export class SurgeDomainSet extends BaseWriteStrategy {
  writeDomain(domain: string): void {
    this.result.push(domain); // example.com
  }

  writeDomainSuffix(domain: string): void {
    this.result.push('.' + domain); // .example.com
  }
}

export class SurgeRuleSet extends BaseWriteStrategy {
  writeDomain(domain: string): void {
    this.result.push(`DOMAIN,${domain}`); // DOMAIN,example.com
  }

  writeDomainSuffix(domain: string): void {
    this.result.push(`DOMAIN-SUFFIX,${domain}`); // DOMAIN-SUFFIX,example.com
  }

  writeIpCidrs(ipCidr: string[]): void {
    ipCidr.forEach(ip => {
      this.result.push(`IP-CIDR,${ip}`); // IP-CIDR,1.2.3.0/24
    });
  }
}
```

### Clash 格式

```typescript
// lib/writing-strategy/clash.ts
export class ClashDomainSet extends BaseWriteStrategy {
  writeDomain(domain: string): void {
    this.result.push(domain); // example.com
  }

  writeDomainSuffix(domain: string): void {
    this.result.push('+.' + domain); // +.example.com
  }
}

export class ClashClassicRuleSet extends BaseWriteStrategy {
  writeDomain(domain: string): void {
    this.result.push(`DOMAIN,${domain}`); // DOMAIN,example.com
  }

  writeDomainSuffix(domain: string): void {
    this.result.push(`DOMAIN-SUFFIX,${domain}`); // DOMAIN-SUFFIX,example.com
  }
}
```

### AdGuardHome 格式

```typescript
// lib/writing-strategy/adguardhome.ts
export class AdGuardHome extends BaseWriteStrategy {
  writeDomain(domain: string): void {
    this.result.push(`|${domain}^`); // |example.com^
  }

  writeDomainSuffix(domain: string): void {
    this.result.push(`||${domain}^`); // ||example.com^
  }

  writeDomainWildcard(wildcard: string): void {
    // *.example.com -> ||example.com^
    if (processed.startsWith('*.')) {
      this.result.push(`||${processed.slice(2)}^`);
    }
  }
}
```

## 5. 输出文件示例

### Surge DomainSet 格式

```
# Sukka's Ruleset
# Last Updated: 2024-01-20

example.com
.ads.com
.tracker.net
```

### Surge RuleSet 格式

```
# Sukka's Ruleset
# Last Updated: 2024-01-20

DOMAIN,example.com
DOMAIN-SUFFIX,ads.com
DOMAIN-SUFFIX,tracker.net
IP-CIDR,1.2.3.0/24
```

### Clash 格式

```
# Sukka's Ruleset
# Last Updated: 2024-01-20

example.com
+.ads.com
+.tracker.net
```

### AdGuardHome 格式

```
! Title: Sukka's Ruleset
! Last modified: Sat, 20 Jan 2024 12:00:00 GMT
! Homepage: https://github.com/SukkaW/Surge

|example.com^
||ads.com^
||tracker.net^
```

## 6. 特殊处理

### IP 段合并优化

```typescript
// 使用 fast-cidr-tools 合并相邻 IP 段
import { merge as mergeCidr } from 'fast-cidr-tools';

// 1.2.3.0/24, 1.2.4.0/24 -> 1.2.2.0/23
ipcidr = mergeCidr(Array.from(this.ipcidr), true);
```

### 通配符域名处理

- Surge/Clash Classic：支持 `DOMAIN-WILDCARD`
- Clash DomainSet：不支持，忽略
- AdGuardHome：转换为 `||domain^` 格式

### 关键词过滤

```typescript
// 创建关键词过滤器，移除白名单关键词
const whiteKwfilter = createKeywordFilter(Array.from(this.whitelistKeywords));
const whitelistedKeywords = Array.from(this.domainKeywords).filter(kw => !whiteKwfilter(kw));
```

## 7. 在 esdeath 中实现

如果要在 esdeath 项目中实现类似功能：

```typescript
// 1. 定义转换接口
interface RuleConverter {
  convertDomain(domain: string): string;
  convertDomainSuffix(domain: string): string;
  convertIP(ip: string): string;
}

// 2. 实现各格式转换器
class SurgeConverter implements RuleConverter {
  convertDomain(domain: string): string {
    return `DOMAIN,${domain}`;
  }
  convertDomainSuffix(domain: string): string {
    return `DOMAIN-SUFFIX,${domain}`;
  }
  convertIP(ip: string): string {
    return `IP-CIDR,${ip}`;
  }
}

// 3. 统一处理流程
class RuleProcessor {
  constructor(private converter: RuleConverter) {}

  processAdGuardRule(rule: string): string | null {
    // 解析 AdGuard 规则
    const parsed = parseAdGuardRule(rule);

    // 根据类型转换
    switch (parsed.type) {
      case 'domain':
        return this.converter.convertDomain(parsed.value);
      case 'domainSuffix':
        return this.converter.convertDomainSuffix(parsed.value);
      // ...
    }
  }
}
```

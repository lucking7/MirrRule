# Reject 规则 TLD 合法性检测指南

## 功能概述

本工具用于检测 reject 规则文件中的非法 TLD（顶级域名），参考 Surge-master-2 的实现，确保规则集中的域名都使用合法的 TLD。

## 检测目标文件

- `Surge/Rulesets/reject/block.list`
- `Surge/Rulesets/reject/reject-Loon.list`
- `Surge/Rulesets/reject/reject-QX.list`

## TLD 合法性判定标准

### 被认定为合法的 TLD

1. **ICANN 认证的 TLD**

   - 由 ICANN（互联网名称与数字地址分配机构）正式认证的顶级域名
   - 通过 `tldts` 库的 `isIcann` 字段判定

2. **ICP 备案 TLD 白名单**（130 个）

   - 包括：ren、wang、citic、top、sohu、xin、com、net 等
   - 这些是在中国获得 ICP 备案资质的域名后缀

3. **CDN 和云服务域名**

   - AWS：cloudfront.net、s3.amazonaws.com 等
   - Akamai：akamaihd.net、akamaized.net、akadns.net
   - Google：appspot.com、googleapis.com、googleusercontent.com
   - GitHub：github.io、githubusercontent.com
   - 其他主流云服务商域名

4. **特殊用途 TLD**

   - localhost、local、test、example、invalid 等
   - 这些是保留给特殊用途的域名

5. **国家/地区代码复合 TLD**
   - com.cn、co.uk、co.jp、com.br 等

### 被认定为非法的 TLD

1. **非标准 TLD**

   - 如：5pk、channelray、con、eastday 等
   - 这些既不是 ICANN 认证，也不在任何白名单中

2. **私有域名**

   - 如：.onion、.tor、.dn42 等
   - 除非在 CDN 白名单中，否则被视为非法

3. **无法解析的域名**
   - 标记为 UNKNOWN 的域名

## 使用方法

### 1. 仅检测（默认模式）

```bash
npm run check:reject-tld
```

输出示例：

```
📊 TLD 合法性检测报告
========================

总体统计:
  📁 检测文件数: 3
  🌐 总域名数: 17,366
  ❌ 非法 TLD 域名数: 23
  📈 非法 TLD 比例: 0.13%
```

### 2. 自动修复模式

```bash
npm run fix:reject-tld
```

该模式会：

- 自动注释掉包含非法 TLD 的规则行
- 在注释中标注非法的 TLD
- 保留原始规则内容，方便后续审查

修复示例：

```
# 修复前
xiaoqiang

# 修复后
# [非法TLD:xiaoqiang] xiaoqiang
```

### 3. 集成到 GitHub Actions

可以将 TLD 检测集成到 CI/CD 流程中：

```yaml
- name: 检测 Reject 规则 TLD 合法性
  run: |
    cd ./Chores/engineering
    npm run check:reject-tld
```

## 输出报告

### 1. 控制台输出

- 总体统计信息
- 非法 TLD 分布（Top 20）
- 每个文件的详细信息
- 具体示例（前 5 个）

### 2. JSON 报告

生成 `reject-tld-check-report.json`，包含：

- 检测时间戳
- 检测模式（check/fix）
- 详细的统计数据
- 所有非法域名的列表

## 白名单维护

如果发现某些合法域名被误判为非法，可以：

1. 在 `ICP_TLD` 数组中添加中国 ICP 备案域名
2. 在 `CDN_AND_CLOUD_DOMAINS` 数组中添加云服务域名
3. 在 `SPECIAL_PURPOSE_TLD` 数组中添加特殊用途域名

## 注意事项

1. **谨慎使用自动修复**

   - 自动修复会直接修改文件
   - 建议先运行检测模式，审查结果后再决定是否修复

2. **定期更新白名单**

   - 随着新的云服务和 CDN 提供商出现，需要更新白名单
   - 可以参考 Surge-master-2 的更新

3. **处理特殊情况**
   - 某些域名可能使用了新的或罕见的 TLD
   - 需要人工判断是否应该加入白名单

## 与 Surge-master-2 的对比

本实现参考了 Surge-master-2 的 TLD 合法性检测机制：

1. **相同点**

   - 使用 `tldts` 库的 `isIcann` 字段
   - 包含 ICP TLD 白名单
   - 过滤私有域名

2. **改进点**

   - 添加了更完整的 CDN 和云服务白名单
   - 提供了友好的报告格式
   - 支持自动修复功能

3. **应用场景**
   - Surge-master-2：在构建时自动过滤
   - esdeath：可选的质量检查步骤

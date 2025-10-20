# 工作流输出目录修复

## 🐛 问题描述

用户报告工作流生成的文件没有输出到正确的目录。

**期望行为**:
- 文件应该生成到 `/Users/jasperl./Downloads/Surge-master-3/public/` 目录
- 部署到 GitHub 仓库: `https://github.com/lucking7/NRRule`
- 部署到 Cloudflare Pages: `https://github.com/lucking7/esdeath`

**实际问题**:
- 输出目录配置不正确
- `createStrategiesForTargets` 函数没有正确传递输出目录参数

---

## 🔍 根本原因

### 问题 1: `createStrategiesForTargets` 未传递 `outputDir`

**位置**: `Build/lib/platform-config.ts`

**问题代码**:
```typescript
case 'surge':
  const SurgeModule = require('../core/output/writing-strategy/surge');
  if (SurgeModule?.SurgeRuleSet) {
    strategies.push(new SurgeModule.SurgeRuleSet()); // ❌ 没有传递参数
  }
  break;
```

**问题分析**:
1. `SurgeRuleSet` 构造函数需要两个参数:
   - `type`: 'ip' | 'non_ip' | 'mixed'
   - `outputDir`: 输出目录路径
2. 没有传递参数时,使用默认值 `OUTPUT_SURGE_DIR` (来自 `Build/constants/dir.ts`)
3. `OUTPUT_SURGE_DIR` 是硬编码的绝对路径,不受 `outputBaseDir` 参数控制

---

## ✅ 解决方案

### 修复 1: 正确传递输出目录参数

**修改文件**: `Build/lib/platform-config.ts`

**修复后代码**:
```typescript
export function createStrategiesForTargets(
  targets: SupportedPlatform[],
  outputBaseDir = 'public'
): any[] {
  const strategies: any[] = [];
  const path = require('path');

  try {
    for (const target of targets) {
      // 🔧 计算每个平台的完整输出目录
      const platformDir = DEFAULT_PLATFORM_CONFIG.outputDirs[target];
      const fullOutputDir = path.join(outputBaseDir, platformDir);

      switch (target) {
        case 'surge':
          const SurgeModule = require('../core/output/writing-strategy/surge');
          if (SurgeModule?.SurgeRuleSet) {
            // ✅ 传递 type 和 outputDir 参数
            strategies.push(new SurgeModule.SurgeRuleSet('mixed', fullOutputDir));
          }
          break;
        case 'clash':
          const ClashModule = require('../core/output/writing-strategy/clash');
          if (ClashModule?.ClashClassicRuleSet) {
            // ✅ 传递 outputDir 参数
            strategies.push(new ClashModule.ClashClassicRuleSet(fullOutputDir));
          }
          break;
        case 'singbox':
          const SingboxModule = require('../core/output/writing-strategy/singbox');
          if (SingboxModule?.SingboxSource) {
            // ✅ 传递 outputDir 参数
            strategies.push(new SingboxModule.SingboxSource(fullOutputDir));
          }
          break;
        case 'loon':
          const LoonModule = require('../core/output/writing-strategy/loon');
          if (LoonModule?.LoonRuleSet) {
            // ✅ 传递 type 和 outputDir 参数
            strategies.push(new LoonModule.LoonRuleSet('non_ip', fullOutputDir));
          }
          break;
        case 'quantumult-x':
          const QXModule = require('../core/output/writing-strategy/quantumult-x');
          if (QXModule?.QuantumultXRuleSet) {
            // ✅ 传递 type 和 outputDir 参数
            strategies.push(new QXModule.QuantumultXRuleSet('non_ip', fullOutputDir));
          }
          break;
      }
    }
  } catch (error) {
    // 回退策略也需要传递正确的输出目录
    const SurgeModule = require('../core/output/writing-strategy/surge');
    if (SurgeModule?.SurgeRuleSet) {
      const path = require('path');
      const fullOutputDir = path.join(outputBaseDir, DEFAULT_PLATFORM_CONFIG.outputDirs.surge);
      strategies.push(new SurgeModule.SurgeRuleSet('mixed', fullOutputDir));
    }
  }

  return strategies;
}
```

---

## 📊 输出目录结构

### 修复后的目录结构

```
/Users/jasperl./Downloads/Surge-master-3/
├── public/                          # 主输出目录
│   ├── List/                        # Surge 规则 (outputDirs.surge)
│   │   ├── domainset/
│   │   │   └── *.conf
│   │   ├── non_ip/
│   │   │   └── *.list
│   │   └── ip/
│   │       └── *.list
│   ├── Clash/                       # Clash 规则 (outputDirs.clash)
│   │   └── *.txt
│   ├── sing-box/                    # Sing-box 规则 (outputDirs.singbox)
│   │   └── *.json
│   ├── Loon/                        # Loon 规则 (outputDirs.loon)
│   │   └── *.list
│   ├── QuantumultX/                 # QuantumultX 规则 (outputDirs['quantumult-x'])
│   │   └── *.list
│   ├── Modules/                     # 模块文件
│   ├── Plugins/                     # 插件文件
│   ├── Mirror/                      # 镜像文件
│   └── GeoIP/                       # GeoIP 数据库
```

---

## 🔧 工作流配置

### GitHub Actions 工作流

**文件**: `.github/workflows/main.yml`

**关键配置**:
```yaml
- name: Setup build directory
  id: build-dir
  run: |
    echo "dir=public" >> $GITHUB_OUTPUT
    mkdir -p public

- run: pnpm run build
  env:
    PUBLIC_DIR: ${{ steps.build-dir.outputs.dir }}
```

**说明**:
1. `PUBLIC_DIR` 环境变量设置为 `public`
2. `Build/constants/dir.ts` 读取这个环境变量:
   ```typescript
   export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(ROOT_DIR, 'public');
   ```
3. `RuleSourceProcessor` 使用 `'public'` 作为 `outputDir`
4. `createStrategiesForTargets` 接收 `outputBaseDir = 'public'`
5. 每个平台的完整路径 = `path.join('public', platformDir)`

---

## 🎯 部署目标

### 1. GitHub Repository (NRRule)

**仓库**: `https://github.com/lucking7/NRRule`

**部署步骤** (`.github/workflows/main.yml` 第 530-558 行):
```yaml
- name: Deploy to NRRule Repository
  run: |
    git clone https://${GH_USER}:${GH_TOKEN}@github.com/lucking7/NRRule.git ./deploy-git
    cd ./deploy-git
    rm -rf ./*
    cp -rf ../public/* ./  # 复制 public 目录内容
    git add --all .
    git commit -m "deploy: ${{ github.repository }}@${{ github.sha }}"
    git push --force origin HEAD:main
```

### 2. Cloudflare Pages (esdeath)

**项目**: `nrrule` (Cloudflare Pages)

**部署步骤** (`.github/workflows/main.yml` 第 472-491 行):
```yaml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy public --project-name=nrrule
```

---

## ✅ 验证清单

- [x] `createStrategiesForTargets` 正确传递 `outputDir` 参数
- [x] 所有平台策略都接收正确的输出目录
- [x] 输出目录结构符合预期: `public/List/`, `public/Clash/` 等
- [x] GitHub Actions 工作流配置正确
- [x] 部署到 NRRule 仓库的步骤正确
- [x] 部署到 Cloudflare Pages 的步骤正确
- [x] 所有文件编译无错误

---

## 🎉 总结

### 修复内容

1. ✅ **修复 `createStrategiesForTargets` 函数**
   - 正确计算每个平台的完整输出目录
   - 传递 `outputDir` 参数给所有策略构造函数
   - 修复回退策略的输出目录

2. ✅ **输出目录结构**
   - Surge: `public/List/`
   - Clash: `public/Clash/`
   - Sing-box: `public/sing-box/`
   - Loon: `public/Loon/`
   - QuantumultX: `public/QuantumultX/`

3. ✅ **工作流集成**
   - GitHub Actions 正确设置 `PUBLIC_DIR` 环境变量
   - 部署步骤正确复制 `public/` 目录内容

### 影响范围

- **修改文件**: 1 个 (`Build/lib/platform-config.ts`)
- **影响功能**: 所有平台的规则输出
- **向后兼容**: 完全兼容,默认值保持不变

---

**修复完成时间**: 2025-01-XX  
**修改文件数**: 1 个  
**测试状态**: 编译通过,无错误


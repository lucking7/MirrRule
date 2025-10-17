# 🔍 插件转换失败诊断和解决方案

## 📊 问题总结

**现象**：Convert Plugins 任务中，所有 185 个插件转换都返回 HTTP 500 错误

**已排除的原因**：
- ❌ 服务未启动（健康检查通过）
- ❌ 超时问题（已增加到 600 秒）
- ❌ 重试不足（已添加重试机制）

**最可能的原因**：⭐
1. **上游插件源不可用**（kelee.one 服务器问题）
2. Script-Hub 内部错误（解析器、依赖服务）
3. 网络连接问题（GitHub Actions → kelee.one）

---

## 🎯 根因分析

### 1. 健康检查 vs 实际转换的差异

| 检查类型 | 健康检查 | 实际转换 |
|---------|---------|---------|
| **请求** | `GET /` | `GET /file/_start_/https://kelee.one/.../xxx.lpx/_end_/xxx.sgmodule` |
| **验证** | 服务进程响应 | 完整转换流程 |
| **依赖** | 无 | 上游源、网络、解析器、转换逻辑 |

**结论**：健康检查只验证服务进程，不验证实际功能。

### 2. 转换流程分析

```
用户请求
    ↓
Script-Hub 接收
    ↓
解析 URL 参数
    ↓
下载上游源文件 ← ⚠️ 最可能的失败点
(https://kelee.one/Tool/Loon/Lpx/xxx.lpx)
    ↓
解析 .lpx 文件
    ↓
转换为 .sgmodule
    ↓
返回结果
```

**关键发现**：
- 所有插件都来自同一个源：`kelee.one`
- 100% 失败率表明不是个别插件问题
- 很可能是上游源整体不可用

---

## 🔧 诊断方案

### 方案 A: 添加完整诊断流程

修改 `.github/workflows/main.yml`：

```yaml
- name: Diagnose Script-Hub and upstream source
  run: |
    echo "=== 🔍 开始诊断 ==="
    
    # 1. 测试上游源可用性
    echo ""
    echo "1️⃣ 测试上游插件源 (kelee.one)..."
    if curl -I -m 10 https://kelee.one/Tool/Loon/Lpx/Google.lpx 2>&1 | grep -q "200\|301\|302"; then
      echo "✅ 上游源可用"
    else
      echo "❌ 上游源不可用或超时"
      echo "   这可能是转换失败的根本原因"
    fi
    
    # 2. 检查 DNS 解析
    echo ""
    echo "2️⃣ 检查 DNS 解析..."
    nslookup kelee.one || echo "⚠️ DNS 解析失败"
    
    # 3. 检查 Script-Hub 容器状态
    echo ""
    echo "3️⃣ Script-Hub 容器状态..."
    CONTAINER_ID=$(docker ps -q --filter "ancestor=xream/script-hub:latest")
    if [ -n "$CONTAINER_ID" ]; then
      echo "容器 ID: $CONTAINER_ID"
      docker stats --no-stream $CONTAINER_ID
      echo ""
      echo "容器进程："
      docker top $CONTAINER_ID
    else
      echo "❌ 未找到 Script-Hub 容器"
    fi
    
    # 4. 测试单个插件转换
    echo ""
    echo "4️⃣ 测试单个插件转换..."
    TEST_URL="http://script.hub:9101/file/_start_/https://kelee.one/Tool/Loon/Lpx/Google.lpx/_end_/Google.sgmodule?type=loon-plugin&target=surge-module"
    
    if curl -f -m 30 -v "$TEST_URL" -H "User-Agent: Surge Mac/2985" > /tmp/test-plugin.sgmodule 2>&1; then
      echo "✅ 单个插件转换成功"
      echo "输出大小: $(wc -c < /tmp/test-plugin.sgmodule) 字节"
    else
      echo "❌ 单个插件转换失败"
      echo ""
      echo "Script-Hub 日志（最后 50 行）："
      docker logs $CONTAINER_ID 2>&1 | tail -50
    fi
    
    echo ""
    echo "=== 诊断完成 ==="

- name: Convert plugins with enhanced error handling
  id: convert
  continue-on-error: true
  run: |
    pnpm run convert-plugins --wait-service --timeout 600 || {
      echo ""
      echo "❌ 转换失败，获取详细日志..."
      echo ""
      echo "=== Script-Hub 完整日志 ==="
      docker logs $(docker ps -q --filter "ancestor=xream/script-hub:latest") 2>&1
      exit 1
    }
```

---

## ✅ 解决方案

### 🚀 方案 1: 预转换策略（推荐）

**原理**：提前转换好插件并存储，不依赖实时转换

#### 步骤 1: 创建预转换脚本

创建 `scripts/pre-convert-plugins.sh`：

```bash
#!/bin/bash
set -e

echo "🔄 开始预转换插件..."

# 启动 Script-Hub 容器
docker run -d --name script-hub -p 9101:9101 xream/script-hub:latest

# 等待服务就绪
echo "⏳ 等待 Script-Hub 服务启动..."
for i in {1..30}; do
  if curl -f -s http://localhost:9101/ > /dev/null 2>&1; then
    echo "✅ Script-Hub 服务就绪"
    sleep 3
    break
  fi
  sleep 5
done

# 运行转换
cd "$(dirname "$0")/.."
pnpm run convert-plugins --wait-service --timeout 600

# 保存结果
mkdir -p public/Plugins/Pre-converted
cp -r public/Plugins/*.sgmodule public/Plugins/Pre-converted/ 2>/dev/null || true

# 清理
docker stop script-hub
docker rm script-hub

echo "✅ 预转换完成"
echo "文件已保存到: public/Plugins/Pre-converted/"
```

#### 步骤 2: 手动运行预转换

```bash
chmod +x scripts/pre-convert-plugins.sh
./scripts/pre-convert-plugins.sh

# 提交预转换的文件
git add public/Plugins/Pre-converted/
git commit -m "chore: 添加预转换的插件"
git push
```

#### 步骤 3: 修改工作流使用预转换文件

```yaml
convert-plugins:
  name: Convert Plugins
  needs: prepare
  if: needs.prepare.outputs.should_convert_plugins == 'true'
  runs-on: ubuntu-latest
  continue-on-error: true
  steps:
    - uses: actions/checkout@v4
    
    - name: Use pre-converted plugins
      id: use-preconverted
      run: |
        if [ -d "public/Plugins/Pre-converted" ] && [ "$(ls -A public/Plugins/Pre-converted)" ]; then
          echo "✅ 使用预转换的插件"
          mkdir -p public/Plugins
          cp -r public/Plugins/Pre-converted/* public/Plugins/
          echo "copied=true" >> $GITHUB_OUTPUT
        else
          echo "⚠️ 未找到预转换的插件，将进行实时转换"
          echo "copied=false" >> $GITHUB_OUTPUT
        fi
    
    # 只有在没有预转换文件时才进行实时转换
    - name: Real-time conversion (fallback)
      if: steps.use-preconverted.outputs.copied == 'false'
      # ... 原有的转换逻辑
```

**优点**：
- ✅ 不依赖 Script-Hub 服务
- ✅ 转换速度快（直接复制）
- ✅ 可靠性高
- ✅ 节省 Actions 时间

**缺点**：
- ⚠️ 需要定期更新（建议每周或每月）
- ⚠️ 增加仓库大小（约 1-5MB）

---

### 🔧 方案 2: 分批转换

如果是并发问题，修改转换逻辑：

创建 `Build/convert-plugins-batched.ts`：

```typescript
import { convertPlugin } from './integration/plugin-converter/script-hub-client';
import type { PluginInfo } from './integration/plugin-converter/types';

async function convertPluginsInBatches(
  plugins: PluginInfo[],
  batchSize = 10,
  delayBetweenBatches = 2000
) {
  const results = [];
  const totalBatches = Math.ceil(plugins.length / batchSize);
  
  for (let i = 0; i < plugins.length; i += batchSize) {
    const batch = plugins.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    
    console.log(`\n🔄 转换批次 ${batchNumber}/${totalBatches} (${batch.length} 个插件)`);
    
    // 并发转换当前批次
    const batchResults = await Promise.all(
      batch.map(plugin => convertPlugin(plugin))
    );
    
    results.push(...batchResults);
    
    // 统计当前批次结果
    const batchSuccess = batchResults.filter(r => typeof r === 'string').length;
    console.log(`  ✅ 成功: ${batchSuccess}/${batch.length}`);
    
    // 批次间等待，避免过载
    if (i + batchSize < plugins.length) {
      console.log(`  ⏳ 等待 ${delayBetweenBatches}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  return results;
}

export { convertPluginsInBatches };
```

修改工作流：

```yaml
- name: Convert plugins in batches
  run: |
    # 使用分批转换，每批 10 个，批次间等待 2 秒
    pnpm run node ./Build/convert-plugins-batched.ts \
      --batch-size 10 \
      --delay 2000 \
      --timeout 600
```

---

### 🌐 方案 3: 镜像上游源

如果 kelee.one 不稳定，创建镜像：

```yaml
- name: Mirror plugin source
  run: |
    echo "🪞 镜像插件源..."
    mkdir -p .cache/plugins
    
    # 下载所有插件到本地
    wget -r -np -nH --cut-dirs=3 \
      -P .cache/plugins \
      -A "*.lpx" \
      https://kelee.one/Tool/Loon/Lpx/ || true
    
    # 上传到自己的服务器或 GitHub Release
    # ...
```

---

### 🏗️ 方案 4: 优化 Docker 配置

添加资源限制和更好的健康检查：

```yaml
services:
  script-hub:
    image: xream/script-hub:latest
    ports:
      - 9100:9100
      - 9101:9101
    options: >-
      --memory=2g
      --cpus=1.5
      --health-cmd="curl -f http://localhost:9101/ || exit 1"
      --health-interval=10s
      --health-timeout=5s
      --health-retries=5
      --health-start-period=30s
```

---

## 📋 推荐实施计划

### 立即执行（今天）

1. ✅ **添加诊断流程**（方案 A）
   - 复制上面的诊断代码到工作流
   - 运行一次，查看诊断结果
   - 确认是否是上游源问题

### 短期执行（本周）

2. ✅ **实施预转换策略**（方案 1）
   - 创建预转换脚本
   - 手动运行一次
   - 提交预转换文件到仓库
   - 修改工作流使用预转换文件

### 中期优化（本月）

3. ✅ **优化转换逻辑**
   - 实施分批转换（方案 2）
   - 优化 Docker 配置（方案 4）
   - 添加更详细的错误处理

### 长期规划（按需）

4. ⏳ **考虑自建服务**
   - 如果插件转换是核心功能
   - 部署自己的 Script-Hub 实例
   - 或开发自定义转换工具

---

## 🎯 预期效果

| 方案 | 成功率提升 | 实施难度 | 维护成本 |
|------|-----------|---------|---------|
| **预转换策略** | ⭐⭐⭐⭐⭐ | 低 | 低（定期更新） |
| **分批转换** | ⭐⭐⭐ | 中 | 低 |
| **镜像源** | ⭐⭐⭐⭐ | 中 | 中 |
| **优化配置** | ⭐⭐ | 低 | 低 |
| **自建服务** | ⭐⭐⭐⭐⭐ | 高 | 高 |

**推荐组合**：
- 短期：预转换策略（立即见效）
- 中期：分批转换 + 优化配置（提高稳定性）
- 长期：根据需求决定是否自建服务

---

## 📝 下一步行动

1. [ ] 添加诊断流程到工作流
2. [ ] 运行一次诊断，确认根本原因
3. [ ] 实施预转换策略
4. [ ] 测试验证
5. [ ] 监控后续运行情况

---

**创建时间**: 2025-10-17  
**状态**: 待实施


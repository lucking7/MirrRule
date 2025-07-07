# TLD 验证处理机制说明

## 核心问题解答

### 1. 这些规则被检测后，是否会自动移除？

**答案：不会自动移除，需要手动运行修复命令**

- 默认检测模式：**不会**修改任何文件
- 修复模式：**注释**而非删除（保留原始规则供参考）

### 2. 非法 TLD 和无有效 TLD 会发生什么？

在修复模式下，非法域名会被**注释掉**而非删除：

#### 示例：修复前后对比

**原始文件（reject-QX.list）：**

```
DOMAIN,safebrowsing.googleapis.com
DOMAIN,blaaaa12.googlecode.com
DOMAIN,-normal-lq.zijieapi.com
DOMAIN,airpushmarketing.s3.amazonaws.com
```

**修复后：**

```
# [非法 TLD: googleapis.com] DOMAIN,safebrowsing.googleapis.com
# [非法 TLD: googlecode.com] DOMAIN,blaaaa12.googlecode.com
# [无有效 TLD] DOMAIN,-normal-lq.zijieapi.com
# [非法 TLD: s3.amazonaws.com] DOMAIN,airpushmarketing.s3.amazonaws.com
```

### 3. 为什么不直接删除？

采用**注释**而非**删除**的原因：

1. **可追溯性**：保留历史记录，知道哪些规则被过滤了
2. **可恢复性**：如果误判，可以手动取消注释恢复
3. **调试方便**：能看到过滤原因，便于分析和改进
4. **安全考虑**：避免意外删除重要规则

## 实际影响分析

### 被过滤的域名类型

#### 1. 私有后缀域名

```
safebrowsing.googleapis.com
firebaselogging-pa.googleapis.com
```

- **原因**：googleapis.com 是 Google 注册的私有后缀
- **影响**：这些域名实际上可能是合法的 Google 服务
- **建议**：需要人工审核是否应该加入白名单

#### 2. S3 追踪器

```
adtago.s3.amazonaws.com
airpushmarketing.s3.amazonaws.com
```

- **原因**：s3.amazonaws.com 是 AWS 的私有后缀
- **影响**：正确识别了广告追踪器
- **结果**：这些确实应该被过滤

#### 3. 无效域名

```
-normal-lq.zijieapi.com
```

- **原因**：以 `-` 开头，不是有效的域名格式
- **影响**：原本就不应该在规则中
- **结果**：过滤是正确的

## 使用建议

### 第一步：先检测评估

```bash
cd Chores/engineering
npm run check:surge-tld
```

查看报告，了解会影响哪些域名。

### 第二步：备份原文件

```bash
cp ../../Surge/Rulesets/reject/*.list ../../Surge/Rulesets/reject/backup/
```

### 第三步：执行修复

```bash
npm run fix:surge-tld
```

### 第四步：审核结果

检查被注释的规则，特别关注：

- Google 相关服务（可能需要白名单）
- 已知的合法服务
- 确实是追踪器的域名

### 第五步：手动调整

- 对于误判的域名，取消注释
- 对于需要白名单的，添加到 `PREDEFINED_WHITELIST`

## 特殊情况处理

### CNAME 追踪器

- **不会被过滤**：即使使用了私有后缀
- **原因**：它们正是我们要屏蔽的目标
- **数量**：检测到 16 个 CNAME 追踪器

### 哈希碰撞

- **当前状态**：0 个碰撞
- **意义**：说明没有重复的域名规则
- **用途**：帮助发现重复项

## 与 Surge-master-2 的对比

Surge-master-2 在构建时会：

1. **自动过滤**：在生成规则时就排除非法 TLD
2. **不保留记录**：直接不包含在最终文件中
3. **更激进**：完全移除而非注释

我们的方案：

1. **后处理**：在已有规则上进行验证
2. **保留记录**：注释保留原始信息
3. **更保守**：便于审核和恢复

## 总结

- ✅ **不会自动执行**：需要手动运行修复命令
- ✅ **注释而非删除**：保留原始规则供参考
- ✅ **可恢复**：随时可以取消注释
- ✅ **安全**：避免意外删除重要规则

这种处理方式更适合对现有规则集进行逐步优化，而不是激进地重构。

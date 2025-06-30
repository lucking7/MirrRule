# GitHub Actions 脚本文档

## Script Hub 转换时的统一修复

### 功能说明

在使用 Script Hub 进行 Loon 插件和 QX 重写规则转换时，通过 `evalScriptmodi` 参数注入统一的修复脚本，自动处理以下问题：

### 自动修复的内容

1. **本地地址替换**

   - `127.0.0.1:910[01]` → `script.hub`
   - `127.0.0.1:端口` → `script.hub:端口`
   - `localhost:端口` → `script.hub:端口`
   - `0.0.0.0:端口` → `script.hub:端口`

2. **格式修复**

   - Markdown 链接格式 `[text](url)` → `text[url]`
   - 移除多余空行（连续 3 个以上空行替换为 2 个）

3. **元数据修复**
   - 修复错误的 `#!name` 值（如参数名后缀 `_enable`）
   - 修复错误的 `#!desc` 值（如参数描述后缀 `-脚本开关`）

### 使用方法

修复脚本已集成到 `main.yml` 工作流程中，在转换时自动应用：

```yaml
# Loon 插件转换
download_url="http://localhost:9101/file/_start_/${plugin_url}/_end_/${output_name}.sgmodule?type=loon-plugin&target=surge-module&del=true&evalScriptmodi=${encoded_fix}"

# QX 重写规则转换
download_url="http://localhost:9101/file/_start_/${url}/_end_/${name}.sgmodule?type=qx-rewrite&target=surge-module&del=true&evalScriptmodi=${encoded_fix}"
```

### 优势

- **统一处理**：所有转换使用相同的修复逻辑
- **源头修复**：在转换时即修复问题，无需后续检查
- **高效可靠**：减少了工作流步骤，提高构建效率

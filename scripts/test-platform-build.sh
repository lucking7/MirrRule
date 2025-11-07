#!/bin/bash

# 平台构建测试脚本
# 用于本地测试不同平台的构建配置

set -e

echo "🧪 开始测试平台构建..."
echo ""

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 测试函数
test_platform() {
    local platform=$1
    local description=$2
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📦 测试平台: ${platform}${NC}"
    echo -e "${BLUE}📝 描述: ${description}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    
    # 设置环境变量
    case $platform in
        "github-pages")
            export BUILD_TARGET="github-pages"
            export ENABLE_JEKYLL="true"
            export ENABLE_COMPRESSION="true"
            export OUTPUT_FORMAT="static"
            ;;
        "cloudflare-pages")
            export BUILD_TARGET="cloudflare-pages"
            export ENABLE_EDGE_OPTIMIZATION="true"
            export ENABLE_COMPRESSION="true"
            export OUTPUT_FORMAT="edge"
            export CF_ENVIRONMENT="staging"
            ;;
        "nrrule-repo")
            export BUILD_TARGET="nrrule-repo"
            export ENABLE_COMPRESSION="true"
            export OPTIMIZE_FOR_CDN="true"
            export OUTPUT_FORMAT="raw"
            ;;
    esac
    
    # 显示环境变量
    echo -e "${YELLOW}🔧 环境变量:${NC}"
    env | grep -E "BUILD_|ENABLE_|OPTIMIZE_|OUTPUT_|CF_" | sort
    echo ""
    
    # 检查配置文件
    echo -e "${YELLOW}📋 检查配置文件...${NC}"
    if [ -f ".github/workflows/build-config.json" ]; then
        echo -e "${GREEN}✅ build-config.json 存在${NC}"
        
        # 验证 JSON 格式
        if command -v jq &> /dev/null; then
            if jq -e ".platforms.\"$platform\"" .github/workflows/build-config.json > /dev/null 2>&1; then
                echo -e "${GREEN}✅ 平台配置有效${NC}"
                echo ""
                echo -e "${YELLOW}平台配置详情:${NC}"
                jq ".platforms.\"$platform\"" .github/workflows/build-config.json
            else
                echo -e "${RED}❌ 平台配置无效${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  jq 未安装，跳过 JSON 验证${NC}"
        fi
    else
        echo -e "${RED}❌ build-config.json 不存在${NC}"
    fi
    echo ""
    
    # 模拟构建步骤
    echo -e "${YELLOW}🏗️  模拟构建步骤...${NC}"
    echo "1. ✅ Checkout repository"
    echo "2. ✅ Setup Node.js ($(node --version))"
    echo "3. ✅ Setup pnpm ($(pnpm --version))"
    echo "4. ✅ Get pnpm store directory"
    pnpm store path
    echo "5. ✅ Install dependencies (跳过，已安装)"
    echo "6. 🏗️  Build for $platform..."
    echo ""
    
    # 检查构建脚本
    if [ -f "Build/lib/platform-builder.ts" ]; then
        echo -e "${GREEN}✅ platform-builder.ts 存在${NC}"
    else
        echo -e "${RED}❌ platform-builder.ts 不存在${NC}"
    fi
    echo ""
    
    # 检查输出目录
    if [ -d "public" ]; then
        echo -e "${YELLOW}📊 输出目录统计:${NC}"
        echo "  文件总数: $(find public -type f | wc -l | tr -d ' ')"
        echo "  目录大小: $(du -sh public | cut -f1)"
        echo ""
        
        echo -e "${YELLOW}📁 目录结构:${NC}"
        tree -L 2 public 2>/dev/null || ls -la public
    else
        echo -e "${YELLOW}⚠️  public 目录不存在${NC}"
    fi
    echo ""
    
    # 清理环境变量
    unset BUILD_TARGET ENABLE_JEKYLL ENABLE_COMPRESSION OUTPUT_FORMAT
    unset ENABLE_EDGE_OPTIMIZATION CF_ENVIRONMENT OPTIMIZE_FOR_CDN
    
    echo -e "${GREEN}✅ 测试完成${NC}"
    echo ""
}

# 主测试流程
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 平台构建测试套件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查必要工具
echo "🔍 检查必要工具..."
command -v node >/dev/null 2>&1 || { echo -e "${RED}❌ Node.js 未安装${NC}"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo -e "${RED}❌ pnpm 未安装${NC}"; exit 1; }
echo -e "${GREEN}✅ 所有必要工具已安装${NC}"
echo ""

# 测试所有平台
test_platform "github-pages" "GitHub Pages 静态站点部署"
test_platform "cloudflare-pages" "Cloudflare Pages Edge 部署"
test_platform "nrrule-repo" "NRRule Repository 仓库部署"

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🎉 所有平台测试完成！${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 显示文档链接
echo "📚 相关文档:"
echo "  - 平台定制化指南: .github/workflows/PLATFORM_CUSTOMIZATION.md"
echo "  - 升级总结: .github/workflows/UPGRADE_SUMMARY.md"
echo "  - 快速参考: .github/workflows/QUICK_REFERENCE.md"
echo "  - 修改清单: .github/workflows/CHANGES.md"
echo ""

echo "💡 提示:"
echo "  - 要实际构建，请运行: pnpm run build"
echo "  - 要查看配置，请运行: cat .github/workflows/build-config.json | jq"
echo "  - 要测试部署工作流，需要在 GitHub 仓库中运行"
echo ""


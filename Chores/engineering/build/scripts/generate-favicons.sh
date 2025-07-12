#!/bin/bash

# 脚本用于生成favicon和复制预先准备的图标文件
# 需要安装ImageMagick: brew install imagemagick

# 源文件路径
FAVICON_DIR="Chores/engineering/data/images/favicon"
PNG_SOURCE_DIR="$FAVICON_DIR/png"
OUTPUT_DIR="public"

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

# 检查是否存在预先准备的图标
if [ -f "$PNG_SOURCE_DIR/favicon.png" ]; then
    echo "使用预先准备的PNG图标..."
    
    # 生成ICO文件
    echo "生成favicon.ico..."
    convert -background transparent "$PNG_SOURCE_DIR/favicon.png" -define icon:auto-resize=16,32,48,64 "$OUTPUT_DIR/favicon.ico"
    
    # 复制各种尺寸的PNG图标
    echo "复制各种尺寸的PNG图标..."
    for size in 16 32 64 96 128 192 512; do
        if [ -f "$PNG_SOURCE_DIR/favicon-${size}x${size}.png" ]; then
            echo "- 复制 ${size}x${size} 图标..."
            cp "$PNG_SOURCE_DIR/favicon-${size}x${size}.png" "$OUTPUT_DIR/favicon-${size}x${size}.png"
        else
            echo "- 生成 ${size}x${size} 图标（从favicon.png）..."
            convert -background transparent "$PNG_SOURCE_DIR/favicon.png" -resize ${size}x${size} "$OUTPUT_DIR/favicon-${size}x${size}.png"
        fi
    done
    
    # 处理Apple Touch Icon
    if [ -f "$PNG_SOURCE_DIR/apple-touch-icon.png" ]; then
        echo "复制Apple Touch Icon..."
        cp "$PNG_SOURCE_DIR/apple-touch-icon.png" "$OUTPUT_DIR/apple-touch-icon.png"
    else
        echo "生成Apple Touch Icon..."
        convert -background transparent "$PNG_SOURCE_DIR/favicon.png" -resize 180x180 "$OUTPUT_DIR/apple-touch-icon.png"
    fi
    
    # 如果存在SVG图标，复制它
    if [ -f "$PNG_SOURCE_DIR/favicon.svg" ]; then
        echo "复制SVG图标..."
        cp "$PNG_SOURCE_DIR/favicon.svg" "$OUTPUT_DIR/favicon.svg"
    fi
elif [ -f "$FAVICON_DIR/favicon.svg" ]; then
    echo "使用SVG文件生成图标..."
    
    # 生成ICO文件
    echo "生成favicon.ico..."
    convert -background transparent "$FAVICON_DIR/favicon.svg" -define icon:auto-resize=16,32,48,64 "$OUTPUT_DIR/favicon.ico"
    
    # 生成各种尺寸的PNG图标
    echo "生成不同尺寸的PNG图标..."
    for size in 16 32 64 96 128 192 512; do
        echo "- 生成 ${size}x${size} 图标..."
        convert -background transparent "$FAVICON_DIR/favicon.svg" -resize ${size}x${size} "$OUTPUT_DIR/favicon-${size}x${size}.png"
    done
    
    # 创建Apple Touch Icon
    echo "创建Apple Touch Icon..."
    convert -background transparent "$FAVICON_DIR/favicon.svg" -resize 180x180 "$OUTPUT_DIR/apple-touch-icon.png"
    
    # 复制SVG到输出目录
    echo "复制SVG图标..."
    cp "$FAVICON_DIR/favicon.svg" "$OUTPUT_DIR/favicon.svg"
else
    echo "错误：找不到图标源文件"
    exit 1
fi

# 创建网站清单文件
echo "创建网站清单文件..."
cat > "$OUTPUT_DIR/site.webmanifest" << EOL
{
  "name": "Luck's Surge Rules & Modules Hub",
  "short_name": "Luck's Rules",
  "icons": [
    {
      "src": "/favicon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/favicon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ],
  "theme_color": "#c9211e",
  "background_color": "#ffffff",
  "display": "standalone"
}
EOL

echo "图标生成完成！" 

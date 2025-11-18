#!/bin/bash
# Script-Hub Docker 容器管理脚本

set -e

CONTAINER_NAME="script-hub"
IMAGE_NAME="xream/script-hub:latest"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐳 Script-Hub Docker Manager${NC}\n"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not installed"
    exit 1
fi

case "${1:-start}" in
    start)
        echo "Starting Script-Hub..."
        docker run -d --name ${CONTAINER_NAME} -p 9100:9100 -p 9101:9101 ${IMAGE_NAME} 2>/dev/null || {
            docker start ${CONTAINER_NAME} 2>/dev/null || echo "Container already running"
        }
        echo -e "${GREEN}✓ Container started${NC}"
        echo "Waiting for service..."
        sleep 10
        echo -e "${GREEN}✓ Ready at http://localhost:9101${NC}"
        ;;
    stop)
        echo "Stopping Script-Hub..."
        docker stop ${CONTAINER_NAME}
        echo -e "${GREEN}✓ Stopped${NC}"
        ;;
    remove)
        docker stop ${CONTAINER_NAME} 2>/dev/null || true
        docker rm ${CONTAINER_NAME}
        echo -e "${GREEN}✓ Removed${NC}"
        ;;
    status)
        docker ps -a --filter "name=${CONTAINER_NAME}"
        ;;
    *)
        echo "Usage: $0 {start|stop|remove|status}"
        ;;
esac

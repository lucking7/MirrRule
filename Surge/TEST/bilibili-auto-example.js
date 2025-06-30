/**
 * Bilibili 动态页面处理脚本
 * 支持 auto 参数逻辑：智能判断是否显示"最常访问"模块
 */

// 获取参数
const params = {
  showUpList: $argument.showUpList || 'auto',
  filterTopReplies: $argument.filterTopReplies === 'true',
  airborne: $argument.airborne === 'true',
  airborneDm: $argument.airborneDm === 'true',
};

console.log(`[Bilibili] 参数配置: ${JSON.stringify(params)}`);

// 解析响应体
let body;
try {
  body = JSON.parse($response.body);
} catch (e) {
  console.log(`[Bilibili] 解析响应失败: ${e}`);
  $done({});
}

// 处理动态页面的"最常访问"模块
if (body.data && body.data.up_list) {
  const showUpList = params.showUpList;

  if (showUpList === 'auto') {
    // auto 逻辑：检查是否有正在直播的UP主
    let hasLiveUp = false;

    if (body.data.up_list.list && Array.isArray(body.data.up_list.list)) {
      hasLiveUp = body.data.up_list.list.some(up => {
        // 检查各种可能的直播状态字段
        return (
          up.has_update === 1 || // 有更新（可能是直播）
          up.live_status === 1 || // 正在直播
          up.is_reserve_live === 1 || // 预约直播
          (up.modules && up.modules.module_dynamic && up.modules.module_dynamic.type === 'live')
        ); // 动态类型为直播
      });
    }

    console.log(`[Bilibili] 检测到直播状态: ${hasLiveUp}`);

    // 如果没有直播，隐藏整个最常访问模块
    if (!hasLiveUp) {
      delete body.data.up_list;
      console.log('[Bilibili] 无直播状态，隐藏最常访问模块');
    }
  } else if (showUpList === 'false') {
    // 始终隐藏
    delete body.data.up_list;
    console.log('[Bilibili] 强制隐藏最常访问模块');
  }
  // showUpList === "true" 时不做处理，保持显示
}

// 处理置顶评论过滤
if (params.filterTopReplies && body.data && body.data.replies) {
  // 过滤置顶评论的逻辑
  if (body.data.replies.upper && body.data.replies.upper.top) {
    delete body.data.replies.upper.top;
    console.log('[Bilibili] 已过滤置顶评论');
  }
}

// 返回修改后的响应
$done({ body: JSON.stringify(body) });

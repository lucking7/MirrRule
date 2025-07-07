/**
 * 检查是否可能是 IPv4 地址
 */
export function isProbablyIpv4(str: string): boolean {
  if (!str) return false;

  // 快速检查：必须包含点，但不能以点开始或结束
  if (!str.includes('.') || str.startsWith('.') || str.endsWith('.')) {
    return false;
  }

  // 检查格式：应该是 4 个由点分隔的数字
  const parts = str.split('.');
  if (parts.length !== 4) {
    return false;
  }

  // 检查每个部分是否是有效的数字（0-255）
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255 || part !== num.toString()) {
      return false;
    }
  }

  return true;
}

/**
 * 检查是否可能是 IPv6 地址
 */
export function isProbablyIpv6(str: string): boolean {
  if (!str) return false;

  // IPv6 必须包含冒号
  if (!str.includes(':')) {
    return false;
  }

  // 简单的 IPv6 格式检查
  // 完整的 IPv6 验证很复杂，这里只做基本检查
  const ipv6Pattern =
    /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv6Pattern.test(str);
}

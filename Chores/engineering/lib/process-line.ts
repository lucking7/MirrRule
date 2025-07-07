export function processLine(line: string): string | null {
  // 移除注释
  const commentIndex = line.indexOf('#');
  if (commentIndex >= 0) {
    line = line.substring(0, commentIndex);
  }

  // 移除空白
  line = line.trim();

  // 跳过空行
  if (!line) {
    return null;
  }

  // 处理域名行格式
  if (line.startsWith('.')) {
    // DOMAIN-SUFFIX 格式
    return line.substring(1);
  }

  // 处理其他格式（如 IP、规则等）
  if (line.includes(',')) {
    const parts = line.split(',');
    if (parts[0] === 'DOMAIN-SUFFIX' && parts[1]) {
      return parts[1].trim();
    }
    if (parts[0] === 'DOMAIN' && parts[1]) {
      return parts[1].trim();
    }
  }

  // 默认返回处理后的行
  return line;
}

// 提取域名信息的函数
export function extractDomainFromRule(
  line: string
): { domain: string; includeAllSubdomain: boolean } | null {
  // 移除注释
  const commentIndex = line.indexOf('#');
  if (commentIndex >= 0) {
    line = line.substring(0, commentIndex);
  }

  // 移除空白
  line = line.trim();

  // 跳过空行
  if (!line) {
    return null;
  }

  // 处理 domainset 格式
  if (line.startsWith('.')) {
    // .example.com 格式（包含所有子域名）
    return {
      domain: line.substring(1),
      includeAllSubdomain: true,
    };
  }

  // 处理 ruleset 格式
  if (line.includes(',')) {
    const parts = line.split(',');
    const ruleType = parts[0]?.trim();
    const domain = parts[1]?.trim();

    if (!domain) {
      return null;
    }

    switch (ruleType) {
      case 'DOMAIN':
        return {
          domain,
          includeAllSubdomain: false,
        };
      case 'DOMAIN-SUFFIX':
        return {
          domain,
          includeAllSubdomain: true,
        };
      case 'DOMAIN-KEYWORD':
        // 域名关键词不算作域名
        return null;
      case 'DOMAIN-WILDCARD':
        // 通配符域名暂时按原样返回
        return {
          domain,
          includeAllSubdomain: false,
        };
      default:
        // 其他规则类型（如 IP-CIDR、URL-REGEX 等）
        return null;
    }
  }

  // 处理纯域名格式（假设是域名）
  if (line.includes('.') && !line.includes(' ') && !line.includes('/')) {
    return {
      domain: line,
      includeAllSubdomain: false,
    };
  }

  return null;
}

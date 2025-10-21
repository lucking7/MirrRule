/**
 * 跨平台规则格式常量定义
 * 支持Surge、Loon、QuantumultX等多种代理客户端的规则格式转换
 */

/**
 * 支持的代理客户端平台
 */
export enum ProxyPlatform {
  SURGE = 'surge',
  LOON = 'loon',
  QUANTUMULT_X = 'quantumult-x',
  CLASH = 'clash',
  SINGBOX = 'sing-box',
}

/**
 * 规则类型枚举
 */
export enum RuleType {
  // 域名类规则
  DOMAIN = 'DOMAIN',
  DOMAIN_SUFFIX = 'DOMAIN-SUFFIX',
  DOMAIN_KEYWORD = 'DOMAIN-KEYWORD',
  DOMAIN_WILDCARD = 'DOMAIN-WILDCARD',

  // IP 类规则
  IP_CIDR = 'IP-CIDR',
  IP_CIDR6 = 'IP-CIDR6',
  GEOIP = 'GEOIP',
  IP_ASN = 'IP-ASN',

  // 进程类规则
  PROCESS_NAME = 'PROCESS-NAME',
  PROCESS_PATH = 'PROCESS-PATH',

  // 网络类规则
  USER_AGENT = 'USER-AGENT',
  URL_REGEX = 'URL-REGEX',

  // 端口和协议类规则
  SRC_IP_CIDR = 'SRC-IP-CIDR',
  SRC_PORT = 'SRC-PORT',
  DST_PORT = 'DST-PORT',
  DEST_PORT = 'DEST-PORT', // Loon 使用 DEST-PORT
  PROTOCOL = 'PROTOCOL',
  NETWORK = 'NETWORK', // Clash 使用 NETWORK

  // 逻辑规则
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
}

/**
 * 策略类型枚举
 */
export enum PolicyType {
  DIRECT = 'DIRECT',
  REJECT = 'REJECT',
  REJECT_200 = 'REJECT-200',
  REJECT_IMG = 'REJECT-IMG',
  REJECT_DICT = 'REJECT-DICT',
  REJECT_ARRAY = 'REJECT-ARRAY',
  PROXY = 'PROXY',
}

/**
 * 规则参数类型枚举
 */
export enum RuleParameter {
  PRE_MATCHING = 'pre-matching',
  EXTENDED_MATCHING = 'extended-matching',
  NO_RESOLVE = 'no-resolve',
}

/**
 * 逻辑操作符类型枚举
 */
export enum LogicalOperator {
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
}

/**
 * 平台规则类型映射表
 * 定义不同平台之间的规则类型对应关系
 */
export const PLATFORM_RULE_MAPPING: Record<ProxyPlatform, Record<string, RuleType>> = {
  [ProxyPlatform.SURGE]: {
    // 域名类
    DOMAIN: RuleType.DOMAIN,
    'DOMAIN-SUFFIX': RuleType.DOMAIN_SUFFIX,
    'DOMAIN-KEYWORD': RuleType.DOMAIN_KEYWORD,
    'DOMAIN-WILDCARD': RuleType.DOMAIN_WILDCARD,
    // IP 类
    'IP-CIDR': RuleType.IP_CIDR,
    'IP-CIDR6': RuleType.IP_CIDR6,
    GEOIP: RuleType.GEOIP,
    'IP-ASN': RuleType.IP_ASN,
    // 进程类
    'PROCESS-NAME': RuleType.PROCESS_NAME,
    'PROCESS-PATH': RuleType.PROCESS_PATH,
    // 网络类
    'USER-AGENT': RuleType.USER_AGENT,
    'URL-REGEX': RuleType.URL_REGEX,
    // 端口和协议类
    'SRC-IP-CIDR': RuleType.SRC_IP_CIDR,
    'SRC-PORT': RuleType.SRC_PORT,
    'DST-PORT': RuleType.DST_PORT,
    'DEST-PORT': RuleType.DEST_PORT,
    PROTOCOL: RuleType.PROTOCOL,
    // 逻辑规则
    AND: RuleType.AND,
    OR: RuleType.OR,
    NOT: RuleType.NOT,
  },
  [ProxyPlatform.LOON]: {
    // 域名类
    DOMAIN: RuleType.DOMAIN,
    'DOMAIN-SUFFIX': RuleType.DOMAIN_SUFFIX,
    'DOMAIN-KEYWORD': RuleType.DOMAIN_KEYWORD,
    // IP 类
    'IP-CIDR': RuleType.IP_CIDR,
    'IP-CIDR6': RuleType.IP_CIDR6,
    GEOIP: RuleType.GEOIP,
    'IP-ASN': RuleType.IP_ASN,
    // 进程类
    'PROCESS-PATH': RuleType.PROCESS_PATH,
    // 网络类
    'USER-AGENT': RuleType.USER_AGENT,
    'URL-REGEX': RuleType.URL_REGEX,
    // 端口和协议类
    'SRC-PORT': RuleType.SRC_PORT,
    'DEST-PORT': RuleType.DEST_PORT,
    PROTOCOL: RuleType.PROTOCOL,
  },
  [ProxyPlatform.QUANTUMULT_X]: {
    // 域名类 (使用 host 前缀)
    HOST: RuleType.DOMAIN,
    'HOST-SUFFIX': RuleType.DOMAIN_SUFFIX,
    'HOST-KEYWORD': RuleType.DOMAIN_KEYWORD,
    'HOST-WILDCARD': RuleType.DOMAIN_WILDCARD,
    // IP 类
    'IP-CIDR': RuleType.IP_CIDR,
    'IP6-CIDR': RuleType.IP_CIDR6,
    GEOIP: RuleType.GEOIP,
    'IP-ASN': RuleType.IP_ASN,
    // 网络类
    'USER-AGENT': RuleType.USER_AGENT,
  },
  [ProxyPlatform.CLASH]: {
    // 域名类
    DOMAIN: RuleType.DOMAIN,
    'DOMAIN-SUFFIX': RuleType.DOMAIN_SUFFIX,
    'DOMAIN-KEYWORD': RuleType.DOMAIN_KEYWORD,
    'DOMAIN-WILDCARD': RuleType.DOMAIN_WILDCARD,
    // IP 类
    'IP-CIDR': RuleType.IP_CIDR,
    'IP-CIDR6': RuleType.IP_CIDR6,
    GEOIP: RuleType.GEOIP,
    'IP-ASN': RuleType.IP_ASN,
    // 进程类
    'PROCESS-NAME': RuleType.PROCESS_NAME,
    'PROCESS-PATH': RuleType.PROCESS_PATH,
    // 端口和协议类
    'SRC-IP-CIDR': RuleType.SRC_IP_CIDR,
    'SRC-PORT': RuleType.SRC_PORT,
    'DST-PORT': RuleType.DST_PORT,
    NETWORK: RuleType.NETWORK,
  },
  [ProxyPlatform.SINGBOX]: {
    domain: RuleType.DOMAIN,
    domain_suffix: RuleType.DOMAIN_SUFFIX,
    domain_keyword: RuleType.DOMAIN_KEYWORD,
    ip_cidr: RuleType.IP_CIDR,
    geoip: RuleType.GEOIP,
    ip_asn: RuleType.IP_ASN,
  },
};

/**
 * 反向映射：从标准规则类型到各平台格式
 */
export const RULE_TO_PLATFORM_MAPPING: Record<RuleType, Record<ProxyPlatform, string>> = {
  [RuleType.DOMAIN]: {
    [ProxyPlatform.SURGE]: 'DOMAIN',
    [ProxyPlatform.LOON]: 'DOMAIN',
    [ProxyPlatform.QUANTUMULT_X]: 'HOST',
    [ProxyPlatform.CLASH]: 'DOMAIN',
    [ProxyPlatform.SINGBOX]: 'domain',
  },
  [RuleType.DOMAIN_SUFFIX]: {
    [ProxyPlatform.SURGE]: 'DOMAIN-SUFFIX',
    [ProxyPlatform.LOON]: 'DOMAIN-SUFFIX',
    [ProxyPlatform.QUANTUMULT_X]: 'HOST-SUFFIX',
    [ProxyPlatform.CLASH]: 'DOMAIN-SUFFIX',
    [ProxyPlatform.SINGBOX]: 'domain_suffix',
  },
  [RuleType.DOMAIN_KEYWORD]: {
    [ProxyPlatform.SURGE]: 'DOMAIN-KEYWORD',
    [ProxyPlatform.LOON]: 'DOMAIN-KEYWORD',
    [ProxyPlatform.QUANTUMULT_X]: 'HOST-KEYWORD',
    [ProxyPlatform.CLASH]: 'DOMAIN-KEYWORD',
    [ProxyPlatform.SINGBOX]: 'domain_keyword',
  },
  [RuleType.DOMAIN_WILDCARD]: {
    [ProxyPlatform.SURGE]: 'DOMAIN-WILDCARD',
    [ProxyPlatform.LOON]: 'DOMAIN-WILDCARD',
    [ProxyPlatform.QUANTUMULT_X]: 'HOST-WILDCARD',
    [ProxyPlatform.CLASH]: 'DOMAIN-WILDCARD',
    [ProxyPlatform.SINGBOX]: 'domain_wildcard',
  },
  [RuleType.IP_CIDR]: {
    [ProxyPlatform.SURGE]: 'IP-CIDR',
    [ProxyPlatform.LOON]: 'IP-CIDR',
    [ProxyPlatform.QUANTUMULT_X]: 'IP-CIDR',
    [ProxyPlatform.CLASH]: 'IP-CIDR',
    [ProxyPlatform.SINGBOX]: 'ip_cidr',
  },
  [RuleType.IP_CIDR6]: {
    [ProxyPlatform.SURGE]: 'IP-CIDR6',
    [ProxyPlatform.LOON]: 'IP-CIDR6',
    [ProxyPlatform.QUANTUMULT_X]: 'IP6-CIDR',
    [ProxyPlatform.CLASH]: 'IP-CIDR6',
    [ProxyPlatform.SINGBOX]: 'ip_cidr',
  },
  [RuleType.GEOIP]: {
    [ProxyPlatform.SURGE]: 'GEOIP',
    [ProxyPlatform.LOON]: 'GEOIP',
    [ProxyPlatform.QUANTUMULT_X]: 'GEOIP',
    [ProxyPlatform.CLASH]: 'GEOIP',
    [ProxyPlatform.SINGBOX]: 'geoip',
  },
  [RuleType.IP_ASN]: {
    [ProxyPlatform.SURGE]: 'IP-ASN',
    [ProxyPlatform.LOON]: 'IP-ASN',
    [ProxyPlatform.QUANTUMULT_X]: 'IP-ASN',
    [ProxyPlatform.CLASH]: 'IP-ASN',
    [ProxyPlatform.SINGBOX]: 'ip_asn',
  },
  [RuleType.USER_AGENT]: {
    [ProxyPlatform.SURGE]: 'USER-AGENT',
    [ProxyPlatform.LOON]: 'USER-AGENT',
    [ProxyPlatform.QUANTUMULT_X]: 'USER-AGENT',
    [ProxyPlatform.CLASH]: 'USER-AGENT',
    [ProxyPlatform.SINGBOX]: 'user_agent',
  },
  [RuleType.URL_REGEX]: {
    [ProxyPlatform.SURGE]: 'URL-REGEX',
    [ProxyPlatform.LOON]: 'URL-REGEX',
    [ProxyPlatform.QUANTUMULT_X]: 'URL-REGEX',
    [ProxyPlatform.CLASH]: 'URL-REGEX',
    [ProxyPlatform.SINGBOX]: 'url_regex',
  },
  [RuleType.PROCESS_NAME]: {
    [ProxyPlatform.SURGE]: 'PROCESS-NAME',
    [ProxyPlatform.LOON]: 'PROCESS-NAME',
    [ProxyPlatform.QUANTUMULT_X]: 'PROCESS-NAME',
    [ProxyPlatform.CLASH]: 'PROCESS-NAME',
    [ProxyPlatform.SINGBOX]: 'process_name',
  },
  [RuleType.AND]: {
    [ProxyPlatform.SURGE]: 'AND',
    [ProxyPlatform.LOON]: 'AND',
    [ProxyPlatform.QUANTUMULT_X]: 'AND',
    [ProxyPlatform.CLASH]: 'AND',
    [ProxyPlatform.SINGBOX]: 'and',
  },
  [RuleType.OR]: {
    [ProxyPlatform.SURGE]: 'OR',
    [ProxyPlatform.LOON]: 'OR',
    [ProxyPlatform.QUANTUMULT_X]: 'OR',
    [ProxyPlatform.CLASH]: 'OR',
    [ProxyPlatform.SINGBOX]: 'or',
  },
  [RuleType.NOT]: {
    [ProxyPlatform.SURGE]: 'NOT',
    [ProxyPlatform.LOON]: 'NOT',
    [ProxyPlatform.QUANTUMULT_X]: 'NOT',
    [ProxyPlatform.CLASH]: 'NOT',
    [ProxyPlatform.SINGBOX]: 'not',
  },
};

/**
 * 平台策略映射表
 */
export const PLATFORM_POLICY_MAPPING: Record<ProxyPlatform, Record<string, PolicyType>> = {
  [ProxyPlatform.SURGE]: {
    DIRECT: PolicyType.DIRECT,
    REJECT: PolicyType.REJECT,
    'REJECT-200': PolicyType.REJECT_200,
    'REJECT-IMG': PolicyType.REJECT_IMG,
    'REJECT-DICT': PolicyType.REJECT_DICT,
    'REJECT-ARRAY': PolicyType.REJECT_ARRAY,
    PROXY: PolicyType.PROXY,
  },
  [ProxyPlatform.LOON]: {
    DIRECT: PolicyType.DIRECT,
    REJECT: PolicyType.REJECT,
    'REJECT-200': PolicyType.REJECT_200,
    'REJECT-IMG': PolicyType.REJECT_IMG,
    'REJECT-DICT': PolicyType.REJECT_DICT,
    'REJECT-ARRAY': PolicyType.REJECT_ARRAY,
    PROXY: PolicyType.PROXY,
  },
  [ProxyPlatform.QUANTUMULT_X]: {
    direct: PolicyType.DIRECT,
    reject: PolicyType.REJECT,
    'reject-200': PolicyType.REJECT_200,
    'reject-img': PolicyType.REJECT_IMG,
    'reject-dict': PolicyType.REJECT_DICT,
    'reject-array': PolicyType.REJECT_ARRAY,
    proxy: PolicyType.PROXY,
  },
  [ProxyPlatform.CLASH]: {
    DIRECT: PolicyType.DIRECT,
    REJECT: PolicyType.REJECT,
    PROXY: PolicyType.PROXY,
  },
  [ProxyPlatform.SINGBOX]: {
    direct: PolicyType.DIRECT,
    reject: PolicyType.REJECT,
    proxy: PolicyType.PROXY,
  },
};

/**
 * 反向策略映射：从标准策略类型到各平台格式
 */
export const POLICY_TO_PLATFORM_MAPPING: Record<PolicyType, Record<ProxyPlatform, string>> = {
  [PolicyType.DIRECT]: {
    [ProxyPlatform.SURGE]: 'DIRECT',
    [ProxyPlatform.LOON]: 'DIRECT',
    [ProxyPlatform.QUANTUMULT_X]: 'direct',
    [ProxyPlatform.CLASH]: 'DIRECT',
    [ProxyPlatform.SINGBOX]: 'direct',
  },
  [PolicyType.REJECT]: {
    [ProxyPlatform.SURGE]: 'REJECT',
    [ProxyPlatform.LOON]: 'REJECT',
    [ProxyPlatform.QUANTUMULT_X]: 'reject',
    [ProxyPlatform.CLASH]: 'REJECT',
    [ProxyPlatform.SINGBOX]: 'reject',
  },
  [PolicyType.REJECT_200]: {
    [ProxyPlatform.SURGE]: 'REJECT-200',
    [ProxyPlatform.LOON]: 'REJECT-200',
    [ProxyPlatform.QUANTUMULT_X]: 'reject-200',
    [ProxyPlatform.CLASH]: 'REJECT',
    [ProxyPlatform.SINGBOX]: 'reject',
  },
  [PolicyType.REJECT_IMG]: {
    [ProxyPlatform.SURGE]: 'REJECT-IMG',
    [ProxyPlatform.LOON]: 'REJECT-IMG',
    [ProxyPlatform.QUANTUMULT_X]: 'reject-img',
    [ProxyPlatform.CLASH]: 'REJECT',
    [ProxyPlatform.SINGBOX]: 'reject',
  },
  [PolicyType.REJECT_DICT]: {
    [ProxyPlatform.SURGE]: 'REJECT-DICT',
    [ProxyPlatform.LOON]: 'REJECT-DICT',
    [ProxyPlatform.QUANTUMULT_X]: 'reject-dict',
    [ProxyPlatform.CLASH]: 'REJECT',
    [ProxyPlatform.SINGBOX]: 'reject',
  },
  [PolicyType.REJECT_ARRAY]: {
    [ProxyPlatform.SURGE]: 'REJECT-ARRAY',
    [ProxyPlatform.LOON]: 'REJECT-ARRAY',
    [ProxyPlatform.QUANTUMULT_X]: 'reject-array',
    [ProxyPlatform.CLASH]: 'REJECT',
    [ProxyPlatform.SINGBOX]: 'reject',
  },
  [PolicyType.PROXY]: {
    [ProxyPlatform.SURGE]: 'PROXY',
    [ProxyPlatform.LOON]: 'PROXY',
    [ProxyPlatform.QUANTUMULT_X]: 'proxy',
    [ProxyPlatform.CLASH]: 'PROXY',
    [ProxyPlatform.SINGBOX]: 'proxy',
  },
};

/**
 * 默认策略配置
 */
export const DEFAULT_POLICIES: Record<string, PolicyType> = {
  reject: PolicyType.REJECT,
  REJECT: PolicyType.REJECT,
  ad: PolicyType.REJECT,
  block: PolicyType.REJECT,
  advertising: PolicyType.REJECT,
  direct: PolicyType.DIRECT,
  DIRECT: PolicyType.DIRECT,
  proxy: PolicyType.PROXY,
  PROXY: PolicyType.PROXY,
};

/**
 * 规则参数适用性映射
 * 定义哪些参数可以应用于哪些规则类型
 */
export const PARAMETER_APPLICABILITY: Record<
  RuleParameter,
  {
    ruleTypes: RuleType[];
    policies?: PolicyType[];
    description: string;
  }
> = {
  [RuleParameter.PRE_MATCHING]: {
    ruleTypes: [
      RuleType.DOMAIN,
      RuleType.DOMAIN_SUFFIX,
      RuleType.DOMAIN_KEYWORD,
      RuleType.DOMAIN_WILDCARD,
    ],
    policies: [
      PolicyType.REJECT,
      PolicyType.REJECT_200,
      PolicyType.REJECT_IMG,
      PolicyType.REJECT_DICT,
      PolicyType.REJECT_ARRAY,
    ],
    description: '在域名解析前进行匹配，仅适用于REJECT策略的域名类规则',
  },
  [RuleParameter.EXTENDED_MATCHING]: {
    ruleTypes: [
      RuleType.DOMAIN,
      RuleType.DOMAIN_SUFFIX,
      RuleType.DOMAIN_KEYWORD,
      RuleType.DOMAIN_WILDCARD,
    ],
    description: '启用扩展匹配模式，仅适用于域名类规则',
  },
  [RuleParameter.NO_RESOLVE]: {
    ruleTypes: [RuleType.IP_CIDR, RuleType.IP_CIDR6, RuleType.GEOIP, RuleType.IP_ASN],
    description: '跳过域名解析直接匹配IP，适用于IP类规则、GEOIP规则和IP-ASN规则',
  },
};

/**
 * 平台参数支持映射
 * 定义不同平台对规则参数的支持情况
 */
export const PLATFORM_PARAMETER_SUPPORT: Record<ProxyPlatform, RuleParameter[]> = {
  [ProxyPlatform.SURGE]: [
    RuleParameter.PRE_MATCHING,
    RuleParameter.EXTENDED_MATCHING,
    RuleParameter.NO_RESOLVE,
  ],
  [ProxyPlatform.LOON]: [RuleParameter.NO_RESOLVE],
  [ProxyPlatform.QUANTUMULT_X]: [],
  [ProxyPlatform.CLASH]: [RuleParameter.NO_RESOLVE],
  [ProxyPlatform.SINGBOX]: [],
};

/**
 * 逻辑规则支持映射
 * 定义不同平台对逻辑操作符的支持情况
 */
export const PLATFORM_LOGICAL_SUPPORT: Record<ProxyPlatform, LogicalOperator[]> = {
  [ProxyPlatform.SURGE]: [LogicalOperator.AND, LogicalOperator.OR, LogicalOperator.NOT],
  [ProxyPlatform.LOON]: [LogicalOperator.AND, LogicalOperator.OR, LogicalOperator.NOT],
  [ProxyPlatform.QUANTUMULT_X]: [LogicalOperator.AND, LogicalOperator.OR],
  [ProxyPlatform.CLASH]: [LogicalOperator.AND, LogicalOperator.OR, LogicalOperator.NOT], // Clash.Meta/mihomo支持
  [ProxyPlatform.SINGBOX]: [LogicalOperator.AND, LogicalOperator.OR, LogicalOperator.NOT], // sing-box 支持逻辑规则
};

/**
 * 策略组清理配置
 * 定义哪些规则类型需要进行策略组清理
 */
export const STRATEGY_CLEANUP_CONFIG: Record<
  RuleType,
  {
    requiresPolicy: boolean;
    allowedPolicies?: PolicyType[];
    cleanupMode: 'keep' | 'remove' | 'convert';
    description: string;
  }
> = {
  [RuleType.DOMAIN]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: '域名规则需要保留策略',
  },
  [RuleType.DOMAIN_SUFFIX]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: '域名后缀规则需要保留策略',
  },
  [RuleType.DOMAIN_KEYWORD]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: '域名关键词规则需要保留策略',
  },
  [RuleType.DOMAIN_WILDCARD]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: '域名通配符规则需要保留策略',
  },
  [RuleType.IP_CIDR]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'IP CIDR规则需要保留策略',
  },
  [RuleType.IP_CIDR6]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'IPv6 CIDR规则需要保留策略',
  },
  [RuleType.GEOIP]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'GeoIP规则需要保留策略',
  },
  [RuleType.IP_ASN]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'IP ASN规则需要保留策略',
  },
  [RuleType.USER_AGENT]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'User-Agent规则需要保留策略',
  },
  [RuleType.URL_REGEX]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: 'URL正则规则需要保留策略',
  },
  [RuleType.PROCESS_NAME]: {
    requiresPolicy: true,
    cleanupMode: 'keep',
    description: '进程名规则需要保留策略',
  },
  [RuleType.AND]: {
    requiresPolicy: false,
    cleanupMode: 'convert',
    description: '逻辑AND规则策略从子规则继承',
  },
  [RuleType.OR]: {
    requiresPolicy: false,
    cleanupMode: 'convert',
    description: '逻辑OR规则策略从子规则继承',
  },
  [RuleType.NOT]: {
    requiresPolicy: false,
    cleanupMode: 'convert',
    description: '逻辑NOT规则策略从子规则继承',
  },
};

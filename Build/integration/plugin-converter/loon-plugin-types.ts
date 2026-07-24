/**
 * 参数类型
 */
export type ArgumentType = 'switch' | 'select' | 'input';

/**
 * 参数定义
 */
export interface Argument {
  name: string;
  type: ArgumentType;
  defaultValue: string | boolean;
  tag: string;
  desc: string;
  options?: string[];
  /** 是否为脚本开关（例如 12306_enable） */
  isEnableSwitch?: boolean;
}

/**
 * 脚本类型
 */
export type ScriptType = 'http-request' | 'http-response' | 'cron' | 'event' | 'generic';

/**
 * 脚本定义
 */
export interface Script {
  name: string;
  type: ScriptType;
  pattern: string;
  scriptPath: string;
  requiresBody?: boolean;
  binaryBodyMode?: boolean;
  timeout?: number;
  maxSize?: number;
  argument?: string;
  cronExpression?: string;
  engine?: string;
  enableParam?: string;
}

/**
 * 重写规则
 */
export interface RewriteRule {
  pattern: string;
  replacement: string;
  type:
    | 'reject'
    | 'reject-dict'
    | 'reject-array'
    | 'reject-200'
    | 'reject-img'
    | 'reject-tinygif'
    | 'mock'
    | 'redirect'
    | '302'
    | '307'
    | 'header'
    | 'header-rewrite'
    | 'body-regex'
    | 'jq';
  comment?: string;
  mockData?: {
    dataType?: string;
    statusCode?: number;
    data?: string;
    header?: string;
    dataPath?: string;
  };
  jqExternal?: boolean;
}

/**
 * Header Rewrite 规则
 */
export interface HeaderRewriteRule {
  pattern: string;
  type: 'http-request' | 'http-response';
  action: 'header-del' | 'header-add' | 'header-replace' | 'header-replace-regex';
  params: string[];
  comment?: string;
}

/**
 * MITM 配置
 */
export interface MitmConfig {
  hostnames: string[];
  h2?: boolean;
}

/**
 * 模块元信息
 */
export interface ModuleMetadata {
  name?: string;
  desc?: string;
  author?: string;
  homepage?: string;
  icon?: string;
  openUrl?: string;
  tag?: string;
  category?: string;
  system?: string;
  systemVersion?: string;
  date?: string;
  version?: string;
}

/**
 * Loon 插件结构
 */
export interface LoonPlugin {
  metadata: ModuleMetadata;
  arguments: Argument[];
  rewrites: RewriteRule[];
  headerRewrites?: HeaderRewriteRule[];
  scripts: Script[];
  mitm: MitmConfig;
  rules?: string[];
}

/**
 * Surge 模块结构
 */
export interface SurgeModule {
  metadata: ModuleMetadata;
  arguments: Argument[];
  urlRewrites: RewriteRule[];
  headerRewrites: HeaderRewriteRule[];
  mapLocal: RewriteRule[];
  bodyRewrites: RewriteRule[];
  scripts: Script[];
  mitm: MitmConfig;
  rules?: string[];
}

import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import type {
  MergeConfig,
  MergeConfigFile,
  MergeOptions,
  OutputConfig
} from './types';

type ValidatedMergeConfig = MergeConfigFile & Required<Pick<MergeConfigFile, 'modules' | 'output'>>;

export interface LoadedMergeConfig {
  config: MergeConfig,
  absolutePath: string,
  baseDir: string
}

const MODULE_ID_PATTERN = /^[a-z]\w*$/i;

const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  deduplicateHostnames: true,
  stripComments: true,
  addDividers: true,
  dividerLength: 30
};

export async function loadMergeConfig(configPath: string): Promise<LoadedMergeConfig> {
  const absolutePath = resolveAbsolute(configPath);
  const raw = await fs.readFile(absolutePath, 'utf-8');
  const parsed = YAML.parse(raw) as MergeConfigFile | undefined;

  if (!parsed) {
    throw new Error('配置文件内容为空');
  }

  validateBasicFields(parsed);

  const baseDir = path.dirname(absolutePath);
  const options: MergeOptions = {
    ...DEFAULT_MERGE_OPTIONS
  };
  if (parsed.options) {
    Object.assign(options, parsed.options);
  }

  const normalizedOutput: OutputConfig = {
    sgmodule: resolveRelative(parsed.output.sgmodule, baseDir),
    template: resolveRelative(parsed.output.template, baseDir)
  };

  const config: MergeConfig = {
    ...parsed,
    modules: parsed.modules.map(source => ({ ...source })),
    output: normalizedOutput,
    options
  };

  return {
    config,
    absolutePath,
    baseDir
  };
}

function resolveAbsolute(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function resolveRelative(target: string, baseDir: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }

  const usesRelativeBase = target.startsWith('./') || target.startsWith('../');
  const base = usesRelativeBase ? baseDir : process.cwd();
  return path.resolve(base, target);
}

function validateBasicFields(config: MergeConfigFile): asserts config is ValidatedMergeConfig {
  if (!config.name) {
    throw new Error('配置文件必须包含 name');
  }

  const modules = config.modules;
  if (!modules?.length) {
    throw new Error('配置文件必须至少包含一个 module');
  }

  const output = config.output;
  if (!output?.sgmodule || !output.template) {
    throw new Error('output.sgmodule、output.template 不能为空');
  }
  if ('rulelist' in output) {
    throw new Error('output.rulelist 已停用：合并模块的 [Rule] 段是唯一的规则输出');
  }

  const invalidSource = modules.find(source => !source.url || !source.header);
  if (invalidSource) {
    throw new Error(`模块 ${invalidSource.header} 缺少 url 或 header`);
  }

  const headers = new Set<string>();
  const ids = new Set<string>();
  for (const source of modules) {
    const header = source.header.trim();
    if (!header || /[\n\r,:{}]/.test(header)) {
      throw new Error(`模块名称无效: ${source.header}`);
    }
    // id 直接用作 Surge 参数名，参数名只能用字母、数字和下划线。
    if (typeof source.id !== 'string' || !MODULE_ID_PATTERN.test(source.id)) {
      throw new Error(`模块 ${source.header} 的 id 必须以字母开头，只含字母、数字和下划线: ${source.id}`);
    }
    if (headers.has(header) || ids.has(source.id)) {
      throw new Error(`模块 header 和 id 必须唯一: ${source.header}`);
    }
    // 每个模块只有一个整模块开关；遗留的脚本开关字段会被忽略，因此直接报错。
    const legacy = ['scriptToggle', 'scriptDefaultOn'].find(field => field in source);
    if (legacy) {
      throw new Error(`模块 ${source.header} 的 ${legacy} 已停用：每个模块只有一个整模块开关 <id>`);
    }
    if (source.defaultOff !== undefined && typeof source.defaultOff !== 'boolean') {
      throw new Error(`模块 ${source.header} 的 defaultOff 必须是布尔值`);
    }
    headers.add(header);
    ids.add(source.id);
  }
}

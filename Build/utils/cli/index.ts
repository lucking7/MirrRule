/**
 * CLI工具包统一导出
 * 提供标准化的命令行应用开发基础设施
 *
 * @module cli
 */

export {
  Logger,
  LogLevel,
  type LoggerConfig,
  logger
} from './logger';

export {
  ArgumentParser,
  ArgumentParseError,
  createArgumentParser,
  type ArgumentOption,
  type ParsedArguments
} from './argument-parser';

export {
  CLIFramework,
  createCLI,
  registerGlobalErrorHandlers,
  type CLIConfig,
  type CLIContext
} from './cli-framework';

import { TransformStream } from 'node:stream/web';
import { RuleValidator } from '../utils/validation/validators';

/**
 * 处理单行规则 - 统一使用 RuleValidator 进行注释检测
 *
 * 支持的注释格式:
 * - # - 井号注释 (最常见)
 * - ! - 感叹号注释 (AdBlock 格式)
 * - // - 双斜杠注释 (C/JavaScript 风格)
 * - ; - 分号注释 (INI/配置文件风格)
 *
 * @param line - 待处理的行
 * @returns 处理后的行,如果是注释或空行则返回 null
 */
export function processLine(line: string): string | null {
  const trimmed: string = line.trim();

  if (RuleValidator.shouldSkipLine(trimmed)) {
    return null;
  }

  // 特殊处理: AdGuard Filter 规则 (##.class, ###id 等)
  if (trimmed.startsWith('##') || trimmed.startsWith('###')) {
    // AdGuard Filter can be:
    // ##.class
    // ##tag.class
    // ###id
    return trimmed;
  }

  return trimmed;
}

export class ProcessLineStream extends TransformStream<string, string> {
  constructor() {
    super({
      transform(l, controller) {
        const line = processLine(l);
        if (line) {
          controller.enqueue(line);
        }
      }
    });
  }
}

/**
 * 简单的模板引擎
 * 支持占位符替换: {{variable}} 和 {{{section}}}
 */

import fs from 'node:fs/promises';

/**
 * 模板引擎类
 */
export const TemplateEngine = {
  /**
   * 渲染模板
   * @param template 模板字符串
   * @param data 数据对象
   * @returns 渲染后的字符串
   */
  render(
    template: string,
    data: Record<string, string | number | boolean | null | undefined>
  ): string {
    let result = template;

    // 替换所有占位符
    for (const [key, value] of Object.entries(data)) {
      // 支持两种格式: {{key}} 和 {{{key}}}
      const placeholder = new RegExp(`\\{\\{\\{${key}\\}\\}\\}|\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(placeholder, String(value ?? ''));
    }

    return result;
  },

  /**
   * 从文件加载模板
   * @param filePath 模板文件路径
   * @returns 模板内容
   */
  async loadTemplate(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  },
};

import { BaseWriteStrategy } from './base.js';
import type { Span } from '../../trace/index.js';
import path from 'node:path';
import { createFile } from '../create-file.js';

/**
 * AdGuardHome 域名列表写入策略
 */
export class AdGuardHome implements BaseWriteStrategy {
  private domains: string[] = [];
  private wildcards: string[] = [];

  constructor(private outputDir: string) {}

  writeDomain(domain: string): void {
    this.domains.push(`||${domain}^`);
  }

  writeDomainSuffix(domain: string): void {
    this.domains.push(`||${domain}^`);
  }

  writeDomainKeywords(): void {
    // AdGuardHome 不直接支持关键词，可以转换为通配符
  }

  writeDomainWildcard(wildcard: string): void {
    // 将通配符转换为 AdGuardHome 格式
    // 例如: *.example.com -> ||*.example.com^
    this.wildcards.push(`||${wildcard}^`);
  }

  writeUserAgents(): void {}
  writeProcessNames(): void {}
  writeProcessPaths(): void {}
  writeSourceIpCidrs(): void {}
  writeSourcePorts(): void {}
  writeDestinationPorts(): void {}
  writeProtocols(): void {}
  writeOtherRules(): void {}
  writeUrlRegexes(): void {}
  writeIpCidrs(): void {}
  writeIpCidr6s(): void {}
  writeIpAsns(): void {}
  writeGeoip(): void {}

  getOutputPath(id: string): string {
    return path.join(this.outputDir, `${id}.txt`);
  }

  async write(
    span: Span,
    id: string,
    title: string | null,
    description: string[] | readonly string[] | null,
    date: Date
  ): Promise<void> {
    const outputPath = this.getOutputPath(id);

    const content: string[] = [];

    // 添加头部注释
    if (title) {
      content.push(`# ${title}`);
    }
    if (description && description.length > 0) {
      for (const line of description) {
        content.push(`# ${line}`);
      }
    }
    content.push(`# Last Updated: ${date.toISOString()}`);
    content.push('');

    // 添加域名规则
    content.push(...this.domains);

    // 添加通配符规则
    if (this.wildcards.length > 0) {
      content.push('', '# Wildcards');
      content.push(...this.wildcards);
    }

    await createFile(span, outputPath, content);
  }
}

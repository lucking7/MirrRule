import { BaseWriteStrategy, withBannerArray } from './base.js';
import type { Span } from '../../trace/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createFile } from '../create-file.js';

// 获取当前文件所在目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 输出目录配置 - 指向项目根目录
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const OUTPUT_SURGE_DIR = path.join(REPO_ROOT, 'Surge', 'Rulesets');
const OUTPUT_MODULES_DIR = path.join(REPO_ROOT, 'Surge', 'Modules');

/**
 * Surge 域名集写入策略
 */
export class SurgeDomainSet implements BaseWriteStrategy {
  private domains: string[] = [];

  writeDomain(domain: string): void {
    this.domains.push(domain);
  }

  writeDomainSuffix(domain: string): void {
    this.domains.push(`.${domain}`);
  }

  writeDomainKeywords(): void {
    // Surge domainset 不支持关键词
  }

  writeDomainWildcard(): void {
    // Surge domainset 不支持通配符
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
    return path.join(OUTPUT_SURGE_DIR, 'domainset', `${id}.list`);
  }

  async write(
    span: Span,
    id: string,
    title: string | null,
    description: string[] | readonly string[] | null,
    date: Date
  ): Promise<void> {
    const outputPath = this.getOutputPath(id);
    const content = withBannerArray(title, description, date, this.domains);

    await createFile(span, outputPath, content);
  }
}

/**
 * Surge 规则集写入策略
 */
export class SurgeRuleset implements BaseWriteStrategy {
  private rules: string[] = [];

  writeDomain(domain: string): void {
    this.rules.push(`DOMAIN,${domain}`);
  }

  writeDomainSuffix(domain: string): void {
    this.rules.push(`DOMAIN-SUFFIX,${domain}`);
  }

  writeDomainKeywords(keywords: Set<string>): void {
    for (const keyword of keywords) {
      this.rules.push(`DOMAIN-KEYWORD,${keyword}`);
    }
  }

  writeDomainWildcard(wildcard: string): void {
    this.rules.push(`DOMAIN-WILDCARD,${wildcard}`);
  }

  writeUserAgents(userAgents: Set<string>): void {
    for (const ua of userAgents) {
      this.rules.push(`USER-AGENT,${ua}`);
    }
  }

  writeProcessNames(processNames: Set<string>): void {
    for (const name of processNames) {
      this.rules.push(`PROCESS-NAME,${name}`);
    }
  }

  writeProcessPaths(processPaths: Set<string>): void {
    for (const path of processPaths) {
      this.rules.push(`PROCESS-NAME,${path}`);
    }
  }

  writeSourceIpCidrs(cidrs: string[]): void {
    for (const cidr of cidrs) {
      this.rules.push(`SRC-IP,${cidr}`);
    }
  }

  writeSourcePorts(ports: Set<string>): void {
    for (const port of ports) {
      this.rules.push(`SRC-PORT,${port}`);
    }
  }

  writeDestinationPorts(ports: Set<string>): void {
    for (const port of ports) {
      this.rules.push(`DEST-PORT,${port}`);
    }
  }

  writeProtocols(protocols: Set<string>): void {
    for (const protocol of protocols) {
      this.rules.push(`PROTOCOL,${protocol}`);
    }
  }

  writeOtherRules(rules: string[]): void {
    this.rules.push(...rules);
  }

  writeUrlRegexes(regexes: Set<string>): void {
    for (const regex of regexes) {
      this.rules.push(`URL-REGEX,${regex}`);
    }
  }

  writeIpCidrs(cidrs: string[], noResolve: boolean): void {
    for (const cidr of cidrs) {
      this.rules.push(`IP-CIDR,${cidr}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  writeIpCidr6s(cidrs: string[], noResolve: boolean): void {
    for (const cidr of cidrs) {
      this.rules.push(`IP-CIDR6,${cidr}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  writeIpAsns(asns: Set<string>, noResolve: boolean): void {
    for (const asn of asns) {
      this.rules.push(`IP-ASN,${asn}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  writeGeoip(geoips: Set<string>, noResolve: boolean): void {
    for (const geoip of geoips) {
      this.rules.push(`GEOIP,${geoip}${noResolve ? ',no-resolve' : ''}`);
    }
  }

  getOutputPath(id: string): string {
    return path.join(OUTPUT_SURGE_DIR, `${id}.list`);
  }

  async write(
    span: Span,
    id: string,
    title: string | null,
    description: string[] | readonly string[] | null,
    date: Date
  ): Promise<void> {
    const outputPath = this.getOutputPath(id);
    const content = withBannerArray(title, description, date, this.rules);

    await createFile(span, outputPath, content);
  }
}

/**
 * Surge MITM 模块写入策略
 */
export class SurgeMitmSgmodule implements BaseWriteStrategy {
  private rules: string[] = [];
  private hostnames = new Set<string>();

  writeDomain(): void {}
  writeDomainSuffix(): void {}
  writeDomainKeywords(): void {}
  writeDomainWildcard(): void {}
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

  addHostname(hostname: string): void {
    this.hostnames.add(hostname);
  }

  addRule(rule: string): void {
    this.rules.push(rule);
  }

  getOutputPath(id: string): string {
    return path.join(OUTPUT_MODULES_DIR, `${id}.sgmodule`);
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
      content.push(`#!name=${title}`);
    }
    if (description && description.length > 0) {
      content.push(`#!desc=${description.join(' ')}`);
    }
    content.push(`#!date=${date.toISOString()}`);
    content.push('');

    // 添加规则
    if (this.rules.length > 0) {
      content.push('[Rule]');
      content.push(...this.rules);
      content.push('');
    }

    // 添加 MITM
    if (this.hostnames.size > 0) {
      content.push('[MITM]');
      content.push(`hostname = %APPEND% ${Array.from(this.hostnames).join(', ')}`);
    }

    await createFile(span, outputPath, content);
  }
}

/**
 * Loon输出策略
 * 支持生成Loon代理客户端兼容的规则文件格式
 *
 * 重构记录：使用共享验证器替代重复的验证逻辑
 */

import { BaseWriteStrategy } from './base';
import { MARKER_DOMAIN } from '../../../constants/description';
import { CrossPlatformRuleParser } from '../../parsers';
import { ProxyPlatform } from '../../../constants/rule-formats';
import { DomainValidator, IPValidator, RuleValidator } from '../../../utils/validation/validators';

/**
 * Loon域名集合输出策略
 * 注意：此类是不完整的实现，继承关系已移除以修复编译错误
 */
export class LoonDomainSet {
  protected result: string[] = [MARKER_DOMAIN];

  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器跳过注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      return;
    }

    // 转换为Loon格式
    const converted = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.LOON);
    
    // 对于域名集合，只保留域名部分
    if (converted.startsWith('DOMAIN,')) {
      const domain = converted.split(',')[1];
      if (domain) {
        this.result.push(domain);
      }
    } else if (converted.startsWith('DOMAIN-SUFFIX,')) {
      const domain = converted.split(',')[1];
      if (domain) {
        this.result.push(domain);
      }
    }
  }
}

/**
 * Loon规则集输出策略
 * 注意：此类是不完整的实现，继承关系已移除以修复编译错误
 */
export class LoonRuleSet {
  protected result: string[] = [`DOMAIN,${MARKER_DOMAIN}`];

  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器跳过注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      return;
    }

    // 转换为Loon格式
    const converted = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.LOON);
    
    if (converted && converted !== trimmed) {
      this.result.push(converted);
    } else {
      // 如果无法转换，尝试基础格式处理
      const processed = this.processBasicRule(trimmed);
      if (processed) {
        this.result.push(processed);
      }
    }
  }

  /**
   * 处理基础规则格式
   * 重构：使用共享验证器替代私有验证方法
   */
  private processBasicRule(rule: string): string | null {
    // 处理纯域名
    if (DomainValidator.isDomainLike(rule)) {
      return `DOMAIN,${rule}`;
    }

    // 处理域名后缀 (.example.com)
    if (DomainValidator.isDomainSuffix(rule)) {
      const domain = rule.substring(1);
      return `DOMAIN-SUFFIX,${domain}`;
    }

    // 处理IP CIDR
    const ipType = IPValidator.getIpType(rule);
    if (ipType === 'ipv6') {
      return `IP-CIDR6,${rule}`;
    } else if (ipType === 'ipv4') {
      return `IP-CIDR,${rule}`;
    }

    return null;
  }

}

/**
 * Loon配置文件输出策略
 */
export class LoonConfig  {
  protected result: string[] = [
    '[General]',
    'ipv6 = true',
    'dns-server = system',
    'allow-wifi-access = false',
    'wifi-access-http-port = 7222',
    'wifi-access-socks5-port = 7221',
    'proxy-test-url = http://www.gstatic.com/generate_204',
    'test-timeout = 3',
    '',
    '[Host]',
    `${MARKER_DOMAIN} = reject`,
    '',
    '[Proxy]',
    '',
    '[Remote Proxy]',
    '',
    '[Proxy Group]',
    '',
    '[Rule]'
  ];

  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器跳过注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      return;
    }

    // 转换为Loon格式
    const converted = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.LOON);
    
    if (converted) {
      this.result.push(converted);
    }
  }
}

/**
 * Loon插件输出策略
 */
export class LoonPlugin  {
  protected result: string[] = [
    '#!name=Generated Rules',
    '#!desc=Auto-generated rules for Loon',
    '#!author=SukkaW',
    '#!homepage=https://ruleset.skk.moe',
    '#!icon=https://raw.githubusercontent.com/SukkaW/Surge/master/icon.png',
    '',
    '[Rule]'
  ];

  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器跳过注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      return;
    }

    // 转换为Loon格式
    const converted = CrossPlatformRuleParser.smartConvert(trimmed, ProxyPlatform.LOON);
    
    if (converted) {
      this.result.push(converted);
    }
  }
}

/**
 * Loon重写规则输出策略
 */
export class LoonRewrite  {
  protected result: string[] = [
    '#!name=Generated Rewrite Rules',
    '#!desc=Auto-generated rewrite rules for Loon',
    '#!author=SukkaW',
    '#!homepage=https://ruleset.skk.moe',
    '',
    '[Rewrite]'
  ];

  protected processLine(line: string): void {
    const trimmed = line.trim();

    // 使用共享验证器跳过注释和空行
    if (RuleValidator.shouldSkipLine(trimmed)) {
      return;
    }

    // 对于重写规则，保持原格式
    this.result.push(trimmed);
  }
}

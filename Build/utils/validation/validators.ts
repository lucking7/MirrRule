export class DomainValidator {
  private static readonly DOMAIN_REGEX = /^\w([\w-]*\w)?(\.\w([\w-]*\w)?)*$/;

  static isDomainLike(this: void, text: string): boolean {
    return DomainValidator.DOMAIN_REGEX.test(text);
  }

  static isDomainSuffix(this: void, text: string): boolean {
    if (!text.startsWith('.')) return false;
    return DomainValidator.isDomainLike(text.slice(1));
  }

  static normalize(this: void, domain: string): string {
    return domain.trim().toLowerCase();
  }
}

export class IPValidator {
  private static readonly IPV4_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
  private static readonly IPV6_CIDR_REGEX = /^([\da-f]{1,4}:){2,7}[\da-f]{1,4}(\/\d{1,3})?$/i;

  static isIPv4Cidr(this: void, text: string): boolean {
    if (!IPValidator.IPV4_CIDR_REGEX.test(text)) return false;
    const parts = text.split('/')[0].split('.');
    return parts.every(part => {
      const num = Number.parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  static isIPv6Cidr(this: void, text: string): boolean {
    return IPValidator.IPV6_CIDR_REGEX.test(text);
  }

  static isIpCidr(this: void, text: string): boolean {
    return IPValidator.isIPv4Cidr(text) || IPValidator.isIPv6Cidr(text);
  }

  static getIpType(this: void, text: string): 'ipv4' | 'ipv6' | null {
    if (IPValidator.isIPv4Cidr(text)) return 'ipv4';
    if (IPValidator.isIPv6Cidr(text)) return 'ipv6';
    return null;
  }
}

class URL_Validator {
  private static readonly URL_REGEX = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,})(:\d+)?(\/.*)?$/i;

  static isValidURL(this: void, text: string): boolean {
    return URL_Validator.URL_REGEX.test(text);
  }

  static extractHostname(this: void, url: string): string | null {
    try {
      const urlObj = new URL(url.includes('://') ? url : `https://${url}`);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }
}

export const RuleLineUtils = {
  isComment(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('#') ||
      trimmed.startsWith('!') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith(';')
    );
  },

  removeInlineComment(line: string): string {
    let commentIndex = -1;
    let searchIndex = 0;

    while (searchIndex < line.length) {
      const slashIndex = line.indexOf('//', searchIndex);
      if (slashIndex === -1) break;
      if (slashIndex === 0) {
        commentIndex = slashIndex;
        break;
      }
      const charBefore = line[slashIndex - 1];
      if (charBefore === ' ' || charBefore === '\t') {
        commentIndex = slashIndex;
        break;
      }
      searchIndex = slashIndex + 2;
    }

    if (commentIndex !== -1) {
      return line.slice(0, Math.max(0, commentIndex)).trim();
    }
    return line;
  },

  isEmptyLine(line: string): boolean {
    return line.trim().length === 0;
  },

  isSukkaWatermark(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.includes('7h1s_rul35et_i5_mad3_by_5ukk4w') ||
      trimmed.includes('th1s_rule5et_1s_m4d3_by_5ukk4w') ||
      trimmed.includes('this_ruleset_is_made_by_sukkaw') ||
      (trimmed.includes('ruleset.skk.moe') &&
        (trimmed.includes('7h1s') || trimmed.includes('th1s') || trimmed.includes('this')))
    );
  },

  shouldSkipLine(line: string): boolean {
    return this.isEmptyLine(line) || this.isComment(line) || this.isSukkaWatermark(line);
  },

  parseRule(line: string): { type: string; value: string; params?: string } | null {
    const trimmed = line.trim();
    if (this.shouldSkipLine(trimmed)) return null;

    const parts = trimmed.split(',').map(p => p.trim());
    if (parts.length < 2) return null;

    return {
      type: parts[0].toUpperCase(),
      value: parts[1],
      params: parts.length > 2 ? parts.slice(2).join(',') : undefined,
    };
  },

  isValidRule(line: string): boolean {
    const trimmed = line.trim();
    if (this.shouldSkipLine(trimmed)) return false;

    const parsed = this.parseRule(trimmed);
    if (!parsed) return false;

    const validTypes = [
      'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD',
      'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'IP-ASN',
      'USER-AGENT', 'URL-REGEX', 'PROCESS-NAME', 'PROCESS-PATH',
      'SRC-IP-CIDR', 'SRC-PORT', 'DST-PORT', 'DEST-PORT',
      'PROTOCOL', 'NETWORK', 'AND', 'OR', 'NOT',
    ];

    return validTypes.includes(parsed.type) && Boolean(parsed.value?.length);
  },
};

const _Validator = {
  identifyType(text: string): 'domain' | 'domain-suffix' | 'ipv4' | 'ipv6' | 'url' | 'unknown' {
    if (DomainValidator.isDomainSuffix(text)) return 'domain-suffix';
    const ipType = IPValidator.getIpType(text);
    if (ipType) return ipType;
    if (DomainValidator.isDomainLike(text)) return 'domain';
    if (URL_Validator.isValidURL(text)) return 'url';
    return 'unknown';
  },

  validateAndNormalize(text: string): { normalized: string; type: string; isValid: boolean } {
    const type = this.identifyType(text);
    const isValid = type !== 'unknown';
    let normalized = text.trim();
    if (type === 'domain' || type === 'domain-suffix') {
      normalized = DomainValidator.normalize(normalized);
    }
    return { normalized, type, isValid };
  },
};

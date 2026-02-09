// escape-string-regexp implementation
function escapeStringRegexp(string: string): string {
  return string.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
import { BaseWriteStrategy } from './base';
import { noop } from 'foxts/noop';
import { notSupported } from '../../../lib/misc';

export class AdGuardHome extends BaseWriteStrategy {
  public readonly name = 'adguardhome';

  // readonly type = 'domainset';
  readonly fileExtension = 'txt';
  readonly type = '';

  protected result: string[] = [];

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- abstract method
  withPadding(title: string, description: string[] | readonly string[], date: Date, content: string[]): string[] {
    return [
      `! Title: ${title}`,
      '! Last modified: ' + date.toUTCString(),
      '! Expires: 6 hours',
      '! License: https://github.com/lucking7/esdeath/blob/main/LICENSE',
      '! Homepage: https://nrrule.pages.dev',
      `! Description: ${description.join(' ')}`,
      '!',
      ...content,
      '! EOF'
    ];
  }

  writeDomain(domain: string): void {
    this.result.push(`|${domain}^`);
  }

  writeDomainSuffix(domain: string): void {
    this.result.push(`||${domain}^`);
  }

  writeDomainKeywords(keywords: Set<string>): void {
    for (const keyword of keywords) {
      // Use regex to match keyword
      this.result.push(`/${escapeStringRegexp(keyword)}/`);
    }
  }

  writeDomainWildcard(wildcard: string): void {
    const processed = wildcard.replaceAll('?', '*');
    if (processed.startsWith('*.')) {
      this.result.push(`||${processed.slice(2)}^`);
    } else {
      this.result.push(`|${processed}^`);
    }
  }

  writeUserAgents = noop;
  writeProcessNames = noop;
  writeProcessPaths = noop;
  writeUrlRegexes = noop;
  writeIpCidrs(ipGroup: string[], noResolve: boolean): void {
    if (noResolve) {
      // When IP is provided to AdGuardHome, any domain resolve to those IP will be blocked
      // So we can't do noResolve
      return;
    }
    for (const ipcidr of ipGroup) {
      if (ipcidr.endsWith('/32')) {
        this.result.push(`||${ipcidr.slice(0, -3)}`);
        /* else if (ipcidr.endsWith('.0/24')) {
          results.push(`||${ipcidr.slice(0, -6)}.*`);
        } */
      } else {
        this.result.push(`||${ipcidr}^`);
      }
    }
  }

  writeIpCidr6s(ipGroup: string[], noResolve: boolean): void {
    if (noResolve) {
      // When IP is provided to AdGuardHome, any domain resolve to those IP will be blocked
      // So we can't do noResolve
      return;
    }
    for (const ipcidr of ipGroup) {
      if (ipcidr.endsWith('/128')) {
        this.result.push(`||${ipcidr.slice(0, -4)}`);
      } else {
        this.result.push(`||${ipcidr}`);
      }
    }
  };

  writeGeoip = notSupported('writeGeoip');
  writeIpAsns = notSupported('writeIpAsns');
  writeSourceIpCidrs = notSupported('writeSourceIpCidrs');
  writeSourcePorts = notSupported('writeSourcePorts');
  writeDestinationPorts = noop;
  writeProtocols = noop;
  writeOtherRules = noop;
}

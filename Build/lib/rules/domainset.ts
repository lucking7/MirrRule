import type { Span } from '../../trace';
import { AdGuardHome } from '../../core/output/writing-strategy/adguardhome';
import type { BaseWriteStrategy } from '../../core/output/writing-strategy/base';
import { ClashDomainSet } from '../../core/output/writing-strategy/clash';
import { SingboxSource } from '../../core/output/writing-strategy/singbox';
import { SurgeDomainSet } from '../../core/output/writing-strategy/surge';
import { FileOutput } from './base';

export class DomainsetOutput extends FileOutput {
  strategies: BaseWriteStrategy[] = [
    new SurgeDomainSet(),
    new ClashDomainSet(),
    new SingboxSource('domainset')
  ];
}

export class AdGuardHomeOutput extends FileOutput {
  strategies: BaseWriteStrategy[];

  constructor(
    span: Span,
    id: string,
    outputDir: string
  ) {
    super(span, id);

    this.strategies = [
      new AdGuardHome(outputDir)
    ];
  }
}

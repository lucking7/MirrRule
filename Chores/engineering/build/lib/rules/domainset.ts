import type { Span } from '../../trace/index.js';
import { FileOutput } from './base.js';
import type { BaseWriteStrategy } from '../writing-strategy/base.js';
import { SurgeDomainSet } from '../writing-strategy/surge.js';
import { AdGuardHome } from '../writing-strategy/adguardhome.js';

export class DomainsetOutput extends FileOutput {
  strategies: BaseWriteStrategy[] = [new SurgeDomainSet()];

  constructor(protected span: Span, id: string) {
    super(span, id);
  }
}

export class AdGuardHomeOutput extends FileOutput {
  strategies: BaseWriteStrategy[];

  constructor(span: Span, id: string, outputDir: string) {
    super(span, id);

    this.strategies = [new AdGuardHome(outputDir)];
  }
}

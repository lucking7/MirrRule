import type { Span } from '../../trace';
import { ClashClassicRuleSet } from '../../core/output/writing-strategy/clash';
import { LegacyClashPremiumClassicRuleSet } from '../../core/output/writing-strategy/legacy-clash-premium';
import { SingboxSource } from '../../core/output/writing-strategy/singbox';
import { SurfboardRuleSet } from '../../core/output/writing-strategy/surfboard';
import { SurgeRuleSet } from '../../core/output/writing-strategy/surge';
import { FileOutput } from './base';

export class RulesetOutput extends FileOutput {
  constructor(span: Span, id: string, type: 'non_ip' | 'ip') {
    super(span, id);

    this.strategies = [
      new SurgeRuleSet(type),
      new ClashClassicRuleSet(type),
      new LegacyClashPremiumClassicRuleSet(type),
      new SurfboardRuleSet(type),
      new SingboxSource(type)
    ];
  }
}

export class SurgeOnlyRulesetOutput extends FileOutput {
  constructor(
    span: Span,
    id: string,
    type: 'non_ip' | 'ip' | (string & {}),
    overrideOutputDir?: string
  ) {
    super(span, id);

    this.strategies = [
      new SurgeRuleSet(type, overrideOutputDir)
    ];
  }
}

export class ClashOnlyRulesetOutput extends FileOutput {
  constructor(
    span: Span,
    id: string,
    type: 'non_ip' | 'ip'
  ) {
    super(span, id);

    this.strategies = [
      new ClashClassicRuleSet(type),
      new LegacyClashPremiumClassicRuleSet(type)
    ];
  }
}

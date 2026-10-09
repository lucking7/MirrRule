import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';

export interface CoverageSubscription {
  id: string,
  policy: string,
  lines: readonly string[],
  kind?: 'subscription' | 'inline',
  extendedMatching?: boolean,
  skipped?: 'missing-local-file' | 'unavailable-remote' | 'unsupported-reference' | 'unsupported-options'
}

interface CoverageOwner {
  subscription: string,
  policy: string,
  rule: string,
  line: number
  matchMode?: 'destination' | 'extended'
}

interface CoverageExample {
  rule: string,
  line: number,
  coverage: 'full' | 'partial',
  relation: 'same-policy' | 'different-policy' | 'mixed-policy',
  earlier: CoverageOwner[]
}

interface ConditionalCoverageWarning extends CoverageOwner {
  condition: 'USER-AGENT' | 'PROCESS-NAME',
  laterSubscriptions: number,
  compound: boolean
}

interface SubscriptionCoverage {
  id: string,
  policy: string,
  kind: 'subscription' | 'inline',
  status: 'audited' | 'skipped',
  skipped?: CoverageSubscription['skipped'],
  totalRules: number,
  domainRules: number,
  unsupportedRules: number,
  unsupportedTypes: Record<string, number>,
  conditionalRules: number,
  fullyCoveredDomainRules: number,
  partlyOverlappingDomainRules: number,
  samePolicyRedundancies: number,
  differentPolicyConflicts: number,
  fullyShadowedDomains: boolean,
  fullyShadowedSubscription: boolean,
  examples: CoverageExample[]
}

export interface CoverageAuditReport {
  schemaVersion: 1,
  basis: 'example-order' | 'profile-rule-section',
  scope: string[],
  summary: {
    subscriptions: number,
    auditedSubscriptions: number,
    skippedSubscriptions: number,
    missingLocalSubscriptions: number,
    domainRules: number,
    unsupportedRules: number,
    fullyCoveredDomainRules: number,
    partlyOverlappingDomainRules: number,
    samePolicyRedundancies: number,
    differentPolicyConflicts: number,
    fullyShadowedSubscriptions: number,
    fullyShadowedDomainSubscriptions: number,
    conditionalWarnings: number
  },
  subscriptions: SubscriptionCoverage[],
  conditionalWarnings: ConditionalCoverageWarning[]
}

interface DomainCondition {
  domain: string,
  suffix: boolean,
  owner: CoverageOwner
}

interface DomainNode {
  children: Map<string, DomainNode>,
  exact?: CoverageOwner,
  suffix?: CoverageOwner,
  policies: Map<string, CoverageOwner>
}

function createNode(): DomainNode {
  return { children: new Map(), policies: new Map() };
}

function earlier(a: CoverageOwner | undefined, b: CoverageOwner | undefined, order: Map<string, number>) {
  if (!a) return b;
  if (!b) return a;
  return order.get(a.subscription)! <= order.get(b.subscription)! ? a : b;
}

/** Reversed labels share suffixes; policy representatives also detect earlier exceptions. */
class DomainCoverageIndex {
  private readonly root = createNode();

  constructor(private readonly order: Map<string, number>) {}

  find(condition: DomainCondition): { full: boolean, coverer?: CoverageOwner, owners: CoverageOwner[] } {
    let node: DomainNode | undefined = this.root;
    let coverer: CoverageOwner | undefined;
    const labels = condition.domain.split('.');
    for (let index = labels.length - 1; index >= 0; index--) {
      node = node.children.get(labels[index]);
      if (!node) break;
      coverer = earlier(coverer, node.suffix, this.order);
    }
    if (!condition.suffix) {
      coverer = earlier(coverer, node?.exact, this.order);
      return { full: Boolean(coverer), coverer, owners: coverer ? [coverer] : [] };
    }
    const owners = new Map<string, CoverageOwner>();
    if (coverer) owners.set(coverer.policy, coverer);
    if (node) {
      for (const owner of node.policies.values()) {
        if (!coverer || this.order.get(owner.subscription)! < this.order.get(coverer.subscription)!) {
          owners.set(owner.policy, earlier(owners.get(owner.policy), owner, this.order)!);
        }
      }
    }
    return { full: Boolean(coverer), coverer, owners: [...owners.values()] };
  }

  add(condition: DomainCondition) {
    let node = this.root;
    const labels = condition.domain.split('.');
    for (let index = labels.length - 1; index >= 0; index--) {
      let next = node.children.get(labels[index]);
      if (!next) {
        next = createNode();
        node.children.set(labels[index], next);
      }
      node = next;
      if (!node.policies.has(condition.owner.policy)) {
        node.policies.set(condition.owner.policy, condition.owner);
      }
    }
    if (condition.suffix) node.suffix ??= condition.owner;
    else node.exact ??= condition.owner;
  }
}

/** Split only outer commas; compound rules and quoted paths stay intact. */
export function splitSurgeRuleFields(line: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === quote && line[index - 1] !== '\\') quote = '';
    } else {
 switch (char) {
 case '"':
 case '\'': {
      quote = char;

 break;
 }
 case '(': {
      depth++;

 break;
 }
 case ')': {
      depth--;

 break;
 }
 default: if (char === ',' && depth === 0) {
      fields.push(line.slice(start, index).trim());
      start = index + 1;
    }
 }
}
  }
  fields.push(line.slice(start).trim());
  return fields;
}

export function cleanAuditRuleLine(line: string): string {
  return line.replace(/\s+#.*$/, '').trim();
}

function parseDomain(fields: string[], owner: CoverageOwner): DomainCondition | undefined {
  const type = fields[0]?.toUpperCase();
  if (type !== 'DOMAIN' && type !== 'DOMAIN-SUFFIX') return;
  if (!fields[1] || fields.slice(2).some(field => field !== 'extended-matching' && field !== 'no-resolve')) return;
  const domain = domainToASCII(fields[1].replace(/\.$/, '').toLowerCase());
  if (!domain || domain.length > 253 || isIP(domain) || !/^[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?$/.test(domain)) return;
  if (domain.split('.').some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return;
  return { domain, suffix: type === 'DOMAIN-SUFFIX', owner: { ...owner, rule: `${type},${domain}` } };
}

function relationToPolicy(owners: CoverageOwner[], policy: string): CoverageExample['relation'] {
  const same = owners.some(owner => owner.policy === policy);
  const different = owners.some(owner => owner.policy !== policy);
  return same && different ? 'mixed-policy' : (different ? 'different-policy' : 'same-policy');
}

export function auditRuleCoverage(
  subscriptions: readonly CoverageSubscription[],
  options: { basis?: CoverageAuditReport['basis'], exampleLimit?: number } = {}
): CoverageAuditReport {
  const exampleLimit = options.exampleLimit ?? 5;
  if (!Number.isSafeInteger(exampleLimit) || exampleLimit < 0) throw new Error('exampleLimit must be a non-negative integer');
  const order = new Map<string, number>();
  subscriptions.forEach((subscription, index) => {
    if (order.has(subscription.id)) throw new Error('Subscription ids must be unique');
    order.set(subscription.id, index);
  });
  const destinationIndex = new DomainCoverageIndex(order);
  const extendedIndex = new DomainCoverageIndex(order);
  const report: CoverageAuditReport = {
    schemaVersion: 1,
    basis: options.basis ?? 'example-order',
    scope: [
      'Proves DOMAIN and DOMAIN-SUFFIX condition containment in the supplied outer order, including earlier narrower exceptions. Earlier extended-matching covers plain conditions; plain matching only partially covers extended conditions.',
      'Policy differences are review candidates; intentional service exceptions are not automatically configuration errors.',
      'IP, keyword, wildcard, logical, URL and other unsupported conditions are counted but do not prove unconditional domain shadow.',
      'USER-AGENT and PROCESS-NAME warnings are conditional on request metadata; they never count as unconditional domain coverage.',
      'Profile input audits only its [Rule] section. Supply a sanitized effective profile to include enabled module rules.',
      'Remote subscriptions are not fetched. Missing or unsupported subscriptions are explicit gaps, and earlier gaps may change the actual winner.',
      'Does not simulate observed TLS SNI or HTTP Host, DNS lookup, pre-matching, client runtime indexes, connections or policy group selections.'
    ],
    summary: {
      subscriptions: 0, auditedSubscriptions: 0, skippedSubscriptions: 0, missingLocalSubscriptions: 0,
      domainRules: 0, unsupportedRules: 0, fullyCoveredDomainRules: 0, partlyOverlappingDomainRules: 0,
      samePolicyRedundancies: 0, differentPolicyConflicts: 0, fullyShadowedSubscriptions: 0,
      fullyShadowedDomainSubscriptions: 0, conditionalWarnings: 0
    },
    subscriptions: [],
    conditionalWarnings: []
  };
  subscriptions.forEach((subscription, position) => {
    const result: SubscriptionCoverage = {
      id: subscription.id, policy: subscription.policy, kind: subscription.kind ?? 'subscription',
      status: subscription.skipped ? 'skipped' : 'audited', ...(subscription.skipped && { skipped: subscription.skipped }),
      totalRules: 0, domainRules: 0, unsupportedRules: 0, unsupportedTypes: {}, conditionalRules: 0,
      fullyCoveredDomainRules: 0, partlyOverlappingDomainRules: 0, samePolicyRedundancies: 0,
      differentPolicyConflicts: 0, fullyShadowedDomains: false, fullyShadowedSubscription: false, examples: []
    };
    report.subscriptions.push(result);
    if (result.kind === 'subscription') report.summary.subscriptions++;
    if (subscription.skipped) {
      report.summary.skippedSubscriptions++;
      if (subscription.skipped === 'missing-local-file') report.summary.missingLocalSubscriptions++;
      return;
    }
    if (result.kind === 'subscription') report.summary.auditedSubscriptions++;
    const additions: DomainCondition[] = [];
    // Surge enables extended matching for the entire RULE-SET when any domain rule requests it.
    const extendedMatching = subscription.extendedMatching || subscription.lines.some(raw => {
      const fields = splitSurgeRuleFields(cleanAuditRuleLine(raw));
      return ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD'].includes(fields[0]) && fields.slice(2).includes('extended-matching');
    });
    let conditionalExamples = 0;
    subscription.lines.forEach((raw, lineIndex) => {
      const line = cleanAuditRuleLine(raw);
      if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) return;
      result.totalRules++;
      const fields = splitSurgeRuleFields(line);
      const owner: CoverageOwner = { subscription: subscription.id, policy: subscription.policy, line: lineIndex + 1, rule: '', matchMode: extendedMatching ? 'extended' : 'destination' };
      const condition = parseDomain(fields, owner);
      if (condition) {
        result.domainRules++;
        const destination = destinationIndex.find(condition);
        const extended = extendedIndex.find(condition);
        const coverer = extendedMatching ? extended.coverer : earlier(destination.coverer, extended.coverer, order);
        const coverage = { full: Boolean(coverer), owners: [] as CoverageOwner[] };
        const ownerPolicies = new Map<string, CoverageOwner>();
        for (const prior of [...destination.owners, ...extended.owners]) {
          if (!coverer || prior === coverer || order.get(prior.subscription)! < order.get(coverer.subscription)!) {
            ownerPolicies.set(prior.policy, earlier(ownerPolicies.get(prior.policy), prior, order)!);
          }
        }
        coverage.owners = [...ownerPolicies.values()];
        if (coverage.full) result.fullyCoveredDomainRules++;
        else if (coverage.owners.length) result.partlyOverlappingDomainRules++;
        if (coverage.owners.length) {
          const relation = relationToPolicy(coverage.owners, subscription.policy);
          if (relation === 'same-policy' && coverage.full) result.samePolicyRedundancies++;
          if (relation !== 'same-policy') result.differentPolicyConflicts++;
          if (result.examples.length < exampleLimit) {
            result.examples.push({ rule: condition.owner.rule, line: lineIndex + 1, coverage: coverage.full ? 'full' : 'partial', relation, earlier: coverage.owners.slice(0, exampleLimit) });
          }
        }
        // Fully covered rules cannot win any request. Keep partial suffixes for their remaining domain space.
        if (!coverage.full) additions.push(condition);
        return;
      }
      result.unsupportedRules++;
      const type = /^[A-Z][A-Z0-9-]*$/.test(fields[0] ?? '') ? fields[0] : 'UNRECOGNIZED';
      result.unsupportedTypes[type] = (result.unsupportedTypes[type] ?? 0) + 1;
      const conditionalMatches = [...line.matchAll(/(?:^|\()(USER-AGENT|PROCESS-NAME),([^,()]+)/g)];
      if (conditionalMatches.length) result.conditionalRules++;
      for (const match of conditionalMatches) {
        report.summary.conditionalWarnings++;
        if (conditionalExamples++ < exampleLimit) {
          report.conditionalWarnings.push({
            ...owner, rule: `${match[1]},${match[2].trim()}`, condition: match[1] as ConditionalCoverageWarning['condition'],
            compound: fields[0] !== match[1],
            laterSubscriptions: subscriptions.slice(position + 1).filter(item => item.kind !== 'inline').length
          });
        }
      }
    });
    additions.forEach(condition => (extendedMatching ? extendedIndex : destinationIndex).add(condition));
    result.fullyShadowedDomains = result.domainRules > 0 && result.domainRules === result.fullyCoveredDomainRules;
    result.fullyShadowedSubscription = result.fullyShadowedDomains && result.unsupportedRules === 0;
    report.summary.domainRules += result.domainRules;
    report.summary.unsupportedRules += result.unsupportedRules;
    report.summary.fullyCoveredDomainRules += result.fullyCoveredDomainRules;
    report.summary.partlyOverlappingDomainRules += result.partlyOverlappingDomainRules;
    report.summary.samePolicyRedundancies += result.samePolicyRedundancies;
    report.summary.differentPolicyConflicts += result.differentPolicyConflicts;
    if (result.kind === 'subscription' && result.fullyShadowedSubscription) report.summary.fullyShadowedSubscriptions++;
    if (result.kind === 'subscription' && result.fullyShadowedDomains) report.summary.fullyShadowedDomainSubscriptions++;
  });
  return report;
}

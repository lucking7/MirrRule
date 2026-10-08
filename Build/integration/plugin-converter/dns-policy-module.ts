import { isIP } from 'node:net';
import { getErrorMessage } from '../../lib/misc';
import { canonicalPluginSourceUrl, identifyPluginSource } from './plugin-identity';
import { getPluginContent } from './plugin-mirror';
import { LoonPluginParser } from './loon-plugin-parser';
import { generateSurgeOutput } from './surge-module-serializer';
import { validateScriptPreservation } from './script-extractor';
import type { PluginInfo, PluginConversionResult } from './types';

export const DNS_POLICY_SOURCE_URL = 'https://kelee.one/Tool/Loon/Lpx/Prevent_DNS_Leaks.lpx';
export const DNS_POLICY_ARTIFACT = 'DNS防泄露.sgmodule';

export function isDnsPolicyPlugin(plugin: Pick<PluginInfo, 'url'>): boolean {
  return canonicalPluginSourceUrl(plugin.url) === DNS_POLICY_SOURCE_URL;
}

function isDnsName(value: string): boolean {
  const labels = value.split('.');
  return value.length <= 253 && labels.length > 1 && !isIP(value)
    && labels.every(label => label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
}

/** Accept only the designated source's rule-only shape; drift must fail visibly. */
function parameterizeDnsSource(content: string): string {
  const rules = new Set<string>();
  let inRules = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#!arguments(?:-desc)?\s*=/i.test(line)) {
      throw new Error('DNS policy source must not predeclare module arguments');
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (/^\[Rule\]$/i.test(line)) {
      inRules = true;
      continue;
    }
    const fields = line.split(',').map(field => field.trim());
    const [type, domain, policy] = fields;
    if (!inRules || fields.length !== 3
      || (type.toUpperCase() !== 'DOMAIN' && type.toUpperCase() !== 'DOMAIN-SUFFIX')
      || !isDnsName(domain) || policy.toUpperCase() !== 'PROXY') {
      throw new Error('DNS policy source only supports DOMAIN/DOMAIN-SUFFIX PROXY rules in [Rule]');
    }
    rules.add(`${type.toUpperCase()},${domain.toLowerCase()},{{{policy}}}`);
  }
  if (rules.size === 0) throw new Error('DNS policy source has no active rules');

  const { metadata } = LoonPluginParser.parse(content);
  const output = generateSurgeOutput({
    metadata: { ...metadata, name: metadata.name || 'DNS防泄露', category: metadata.tag },
    arguments: [],
    urlRewrites: [],
    headerRewrites: [],
    mapLocal: [],
    bodyRewrites: [],
    scripts: [],
    mitm: { hostnames: [] },
    rules: Array.from(rules),
  });
  const lines = output.split('\n');
  lines.splice(lines.indexOf(''), 0,
    '#!arguments=policy:Proxy',
    '#!arguments-desc=policy: Existing Surge proxy policy or policy group'
  );
  return lines.join('\n');
}

/** Convert fresh rule-only DNS content before generic Script-Hub conversion. */
export async function loadDnsPolicyModule(
  plugin: PluginInfo,
  loadContent: typeof getPluginContent = getPluginContent
): Promise<PluginConversionResult> {
  const base = { pluginName: plugin.name, ...identifyPluginSource(plugin) };
  if (!isDnsPolicyPlugin(plugin)) {
    return { ...base, content: { error: 'DNS policy source is not the designated canonical source' } };
  }
  try {
    const result = await loadContent(plugin, true);
    if (!result.success || !result.content || result.degraded) {
      return { ...base, content: { error: `DNS policy download failed: ${result.error ?? 'fresh content unavailable'}` } };
    }
    const output = parameterizeDnsSource(result.content);
    const error = validateScriptPreservation(result.content, output);
    return { ...base, content: error ? { error } : output };
  } catch (error) {
    return { ...base, content: { error: `DNS policy conversion failed: ${getErrorMessage(error)}` } };
  }
}

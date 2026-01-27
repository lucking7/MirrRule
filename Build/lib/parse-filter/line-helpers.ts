import { onBlackFound } from './shared';

const rSpace = /\s+/;

export function extractHostsDomain(line: string): string | null {
  const part = line.split(rSpace, 3)[1];
  return part ? part.trim() : null;
}

export function pushNormalizedDomain(
  raw: string | null,
  set: string[],
  meta: string,
  normalize: (input: string) => string | null,
  includeAllSubdomain: boolean
): void {
  if (!raw) return;
  const domain = normalize(raw);
  if (!domain) return;

  onBlackFound(domain, meta);
  set.push(includeAllSubdomain ? `.${domain}` : domain);
}

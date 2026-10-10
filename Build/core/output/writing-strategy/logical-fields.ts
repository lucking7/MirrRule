/** Split logical syntax without interpreting commas inside child expressions or quoted values. */
export function splitLogicalFields(value: string): string[] | null {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '(') depth++;
    if (character === ')' && --depth < 0) return null;
    if (character === ',' && depth === 0) {
      fields.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0 || quoted || escaped) return null;
  fields.push(value.slice(start).trim());
  return fields.every(field => field.length > 0) ? fields : null;
}

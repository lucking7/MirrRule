export function convertRulesBase(
  rules: string[],
  convert: (rule: string) => string
): string[] {
  const converted: string[] = [];
  for (const rule of rules) {
    const value = convert(rule);
    if (value.trim().length > 0) {
      converted.push(value);
    }
  }
  return converted;
}

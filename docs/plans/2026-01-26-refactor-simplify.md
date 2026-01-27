# Rule Pipeline Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce duplicate logic in parsing, output, and scripts while keeping output identical.

**Architecture:** Keep behavior inside existing subsystems but extract shared helpers within each subsystem (parse-filter, parsers, rules, processor, scripts).

**Tech Stack:** Node.js, TypeScript (CommonJS), pnpm.

---

### Task 1: Parse-filter line helpers (A)

**Files:**
- Create: `Build/lib/parse-filter/line-helpers.ts`
- Modify: `Build/lib/parse-filter/hosts.ts`
- Modify: `Build/lib/parse-filter/domainlists.ts`

**Step 1: Add shared helpers**

```ts
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
```

**Step 2: Update `hosts.ts` callbacks to use helpers**

```ts
const raw = extractHostsDomain(line);
pushNormalizedDomain(raw, set, meta, fastNormalizeDomainWithoutWww, false);
```

**Step 3: Update `domainlists.ts` callbacks to use helpers**

```ts
pushNormalizedDomain(line, set, meta, normalizeDomain, true);
```

---

### Task 2: Parser conversion helper (A)

**Files:**
- Create: `Build/core/parsers/convert-helpers.ts`
- Modify: `Build/core/parsers/index.ts`

**Step 1: Add `convertRulesBase` helper**

```ts
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
```

**Step 2: Use helper in `convertRules` and `convertRulesToRuleSet`**

```ts
return convertRulesBase(rules, rule => {
  const parsed = this.parseRule(rule, targetPlatform);
  return parsed ? this.convertToTargetPlatform(parsed, targetPlatform) : rule;
});
```

---

### Task 3: FileOutput helpers (B)

**Files:**
- Create: `Build/lib/rules/rule-line-utils.ts`
- Modify: `Build/lib/rules/base.ts`

**Step 1: Add inline comment helper**

```ts
export function stripTrailingHashComment(line: string): string {
  const index = line.lastIndexOf('#');
  if (index > 0) {
    return line.slice(0, index).trimEnd();
  }
  return line;
}
```

**Step 2: Use helper in `addFromDomainsetPromise` and `addFromRulesetPromise`**

```ts
line = stripTrailingHashComment(line);
```

**Step 3: Extract pending queue helper**

```ts
private enqueuePending(action: () => Promise<void>) {
  if (this.pendingPromise) {
    this.pendingPromise = this.pendingPromise.then(action);
  } else {
    this.pendingPromise = action();
  }
}
```

---

### Task 4: Platform helpers + processor refactor (C)

**Files:**
- Modify: `Build/lib/platform-config.ts`
- Modify: `Build/lib/enhanced-file-output.ts`
- Modify: `Build/lib/rule-source-processor.ts`

**Step 1: Export platform helpers**

```ts
export const isSupportedPlatform = (target: string): target is SupportedPlatform =>
  target === 'surge' || target === 'clash' || target === 'singbox' || target === 'loon';

export function normalizeTargets(
  rawTargets: string[] | undefined,
  fallback: SupportedPlatform[] = ['surge']
): SupportedPlatform[] {
  const targets = (rawTargets ?? []).filter(isSupportedPlatform);
  return targets.length > 0 ? targets : fallback;
}
```

**Step 2: Use `normalizeTargets` in `EnhancedFileOutput.fromConfig`**

```ts
const effectiveTargets = normalizeTargets('targets' in config ? config.targets : undefined);
```

**Step 3: Add a local `createOutput` helper in `rule-source-processor.ts`**

```ts
const effectiveTargets = normalizeTargets(group.targets);
return new EnhancedFileOutput(span, fileName, '', effectiveTargets, defaultPolicy, mergedConfig, this.outputDir);
```

---

### Task 5: Public index sorting module (D)

**Files:**
- Create: `Build/lib/public-index-sort.ts`
- Modify: `Build/build-public.ts`
- Modify: `Build/test-sorting.ts`

**Step 1: Move `priorityOrder` + `prioritySorter` into shared module**

```ts
export const priorityOrder = { /* existing map */ } as const;
export function prioritySorter(a: TreeType, b: TreeType): number { /* existing logic */ }
```

**Step 2: Import and reuse in both files**

```ts
import { priorityOrder, prioritySorter } from './lib/public-index-sort.ts';
```

---

### Task 6: Tarball HEAD helper (D)

**Files:**
- Create: `Build/lib/tarball-utils.ts`
- Modify: `Build/download-mock-modules.ts`
- Modify: `Build/download-previous-build.ts`

**Step 1: Add `headStatus` helper**

```ts
import { requestWithLog } from '../utils/network/fetch-retry.ts';

export async function headStatus(url: string): Promise<number> {
  const resp = await requestWithLog(url, { method: 'HEAD' });
  return resp.statusCode;
}
```

**Step 2: Replace duplicate HEAD checks with helper (keep logs identical)**

```ts
const statusCode = await headStatus(GITHUB_CODELOAD_URL);
if (statusCode !== 200) {
  // existing log messages
}
```

---

### Verification

**Step 1: Lint + typecheck**
Run: `pnpm validate`
Expected: exit code 0

**Step 2: Optional rule validation**
Run: `pnpm validate:rules`
Expected: exit code 0 (may take longer)

---

### Optional Commit (only if requested)

```bash
git add Build/lib Build/core Build/download-mock-modules.ts Build/download-previous-build.ts
git commit -m "refactor: dedupe pipeline helpers"
```

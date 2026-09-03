# Implementation Plan

[Overview]
Complete the five architecture-review candidates in one integration branch while preserving current MirrRule outputs and making upstream, plugin, and public-index behavior testable through stable seams.

The implementation extends PR #390 rather than starting a second competing branch. It keeps the already-verified large special-source fix, then deepens the rule intake, artifact synchronization, source-health, plugin conversion, and public-index modules. Existing CLI entry points, workflow names, output paths, and generated artifact formats remain compatible. The two deleted NSRingo Siri debug URLs are not replaced with `dev`-branch builds; `NSRingo/Siri` continues through release-driven discovery with an explicit current-asset selector and last-known-good publication behavior.

[Types]
Centralize repeated configuration and result semantics without exposing new speculative interfaces.

- `Build/lib/rule-source-types.ts`
  - Add exported `RuleProcessingOptions` for the options shared by `FileConfig` and `SpecialRuleConfig`.
  - Add exported `RulePolicy` and `RuleTarget` aliases.
  - Make `FileConfig` and `SpecialRuleConfig` extend the common options while retaining their existing fields.
- `Build/integration/mirror-sync/sync-engine.ts`
  - Extend `MirrorRepository` with optional `assetNamePattern: RegExp` so release-driven adapters can select a stable asset family.
  - Keep the generic synchronization boundary release-driven; do not retain a direct-file adapter without a production source.
- `Build/lib/source-inventory.ts`
  - Add a request profile to `SourceInventoryEntry` so health probes select the same User-Agent family as the build adapter.
- `Build/integration/plugin-converter/types.ts`
  - Add stable source identity and publish-state fields only where callers need to distinguish ready, degraded, and failed artifacts.
- `Build/lib/public-index-model.ts`
  - Move `ClientDirectory`, `RuleFormat`, `RuleEntry`, and the deterministic public-index model into a dedicated module.

[Files]
Modify existing hot spots and add focused model modules and tests.

- New files:
  - `Build/lib/atomic-file.ts`: shared same-directory temporary write and atomic replacement primitive.
  - `Build/lib/public-index-model.ts`: public artifact catalog, client directory metadata, rule aggregation, and listed-file counting.
  - `Build/integration/plugin-converter/plugin-identity.ts`: canonical URL identity shared by cache and conversion stages.
  - `Build/__tests__/artifact-sync.test.ts`: release selector and shared atomic replacement tests.
  - `Build/integration/plugin-converter/plugin-artifact.ts`: dependency-gated module publication and last-known-good classification.
  - `Build/__tests__/plugin-artifact.test.ts`: ready, degraded, failed, and cache-identity tests.
- Modified files:
  - `Build/lib/rule-source-types.ts`: common rule option types.
  - `Build/lib/rule-source-processor.ts`: common ruleset write path and size-safe batch accumulation.
  - `Build/__tests__/rule-source-processor.test.ts`: large-source and ordinary/special parity coverage.
  - `Build/integration/mirror-sync/sync-engine.ts`: release artifact validation and atomic publication.
  - `Build/integration/mirror-sync/index.ts`: one group execution function used by all/group commands.
  - `Build/integration/mirror-sync/mirror-config.ts`: remove dead Siri debug downloads and select current `iRingo.Siri`, `iRingo.Search`, and `iRingo.Spotlight` release assets.
  - `Build/lib/source-inventory.ts`: request profiles and removal of stale Siri identities through configuration.
  - `Build/validate-domain-alive.ts`: build-compatible User-Agent selection and source-aware probe interface.
  - `Build/__tests__/source-health.test.ts`, `Build/__tests__/source-inventory.test.ts`, `Build/__tests__/mirror-family-registry.test.ts`: updated inventory and request-policy contracts.
  - `Build/integration/plugin-converter/plugin-mirror.ts`: canonical URL identity and atomic cache refresh.
  - `Build/integration/plugin-converter/index.ts`: delay artifact publication until script dependencies are resolved, preserve last-known-good output on dependency failure, and report degraded artifacts.
  - `Build/integration/plugin-converter/types.ts`: lifecycle result types.
  - `Build/__tests__/plugin-script-mirror.test.ts`, `Build/__tests__/plugin-provenance.test.ts`: source identity and dependency-failure coverage.
  - `Build/build-public.ts`: consume the new semantic model, keep rendering and inline runtime behavior, and avoid mutating input trees.
  - `Build/__tests__/build-public.test.ts`: import model functions from their new seam and add immutability coverage.
  - `ARCHITECTURE.md`, `AGENTS.md`: document the resulting deep modules and verification commands without duplicating implementation details.
- Deleted files:
  - None. The obsolete Siri URLs are configuration entries, not files.

[Functions]
Concentrate repeated behavior into existing module seams and add only functions with multiple callers.

- Rule intake and compilation:
  - Add `appendRuleBatch(target: string[], source: readonly string[]): void` in `Build/lib/rule-source-processor.ts`.
  - Add a private ruleset publication function used by both ordinary and special processing paths.
  - Preserve `processRuleGroups()` and `processSpecialRules()` as compatibility entry points.
- Artifact synchronization:
  - Add `publishArtifactAtomic(...)` in `sync-engine.ts` for validation, post-processing, checksum comparison, temporary write, rename, and last-known-good retention.
  - Modify `classifyAsset()` to apply `assetNamePattern` after extension filtering.
  - Add one internal `syncConfiguredGroup()` in `index.ts`; `syncAllMirrors()` and `syncMirrorGroup()` delegate to it.
- Source health:
  - Change `probeSource()` and `SourceProbe` to accept `SourceInventoryEntry` rather than a bare URL.
  - Select `UA_MIRROR` for GitHub release metadata and `UA_SURGE_MAC` for rule inputs.
  - Preserve DNS fallback and exit-code behavior.
- Plugin lifecycle:
  - Add a canonical URL-based plugin cache filename function.
  - Add atomic cache publication and last-known-good reads.
  - Add an internal artifact finalization function that applies script mirror URLs before committing module outputs.
  - Mark conversion results degraded or failed when required script dependencies have no mirrored or cached artifact.
- Public index:
  - Move `collectRules()`, `shouldListFile()`, `countListedFiles()`, and client metadata to `public-index-model.ts`.
  - Modify tree ordering to return sorted copies rather than mutating caller-owned arrays.
  - Keep `ruleCardsHtml()`, `treeHtml()`, and `generateHtml()` in the renderer.

[Classes]
No new classes are required; the change deepens existing modules through functions and discriminated data rather than inheritance.

- `RuleSourceProcessor` remains the rule-intake compatibility class, but repeated publication behavior moves behind a private seam.
- `EnhancedFileOutput`, `FileOutput`, and platform writer classes retain their current interfaces and output semantics.

[Dependencies]
No package additions or version changes are required.

Use existing Node modules, `undici`, current hashing utilities, and existing test helpers. Local verification may use Node 22.23.2 with the repository engine warning, while GitHub Actions remains the authoritative Node 26 verification environment.

[Implementation Order]
Apply vertical, independently testable slices in dependency order, then review and polish the aggregate diff.

1. Preserve PR #390 and add common rule-processing types plus a shared publication seam; rerun targeted rule-source tests.
2. Add shared artifact publication with atomic replacement and release asset selectors; cover it with isolated tests.
3. Remove obsolete Siri debug downloads, configure current Siri release asset selection, and update inventory contracts.
4. Make source-health probes consume source descriptors and build-compatible User-Agents; run the full live health probe.
5. Deepen plugin cache identity and artifact finalization; add lifecycle regression tests.
6. Extract the immutable public-index semantic model; preserve byte-level rendering behavior and add immutability tests.
7. Update architecture and maintainer documentation, then run `pnpm run validate`, targeted tests after each slice, `pnpm test`, `pnpm run knip`, and the full network build.
8. Run parallel Standards and Spec reviews against `main...HEAD`, fix every finding in one polish pass, rerun the complete verification matrix, push the branch, update PR #390, and wait for GitHub Actions.

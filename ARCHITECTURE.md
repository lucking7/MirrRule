# MirrRule Architecture

MirrRule is a rule aggregation pipeline. It downloads upstream rule artifacts, normalizes each line into a shared in-memory rule model, then writes platform-specific outputs for Surge, Clash, Loon, and sing-box.

## Build pipeline

```text
Build/index.ts
  ├─ downloadGEOIP()
  ├─ RuleSourceProcessor
  │   ├─ fetchAssets() / loadRules()
  │   └─ shared ruleset publication
  │       └─ EnhancedFileOutput
  │           └─ createStrategiesForTargets()
  │               ├─ SurgeRuleSet
  │               ├─ ClashClassicRuleSet
  │               ├─ LoonRuleSet
  │               └─ SingboxSource
  └─ buildPublic()
      ├─ public-index-model
      └─ static HTML renderer
```

`EnhancedFileOutput` owns normalization, canonical rule state, finalization, and logical rule summaries. Its state is private; platform writers remain four adapters behind the existing writer seam. `RuleSourceProcessor` retains the same publication interface. Each output instance is finalized once, by either `compile()` or `write()`.

Canonical rule collections deduplicate through Trie/Set storage, then platform writers apply their fixed output order. Clash and Loon share the default passthrough conversion in `BaseWriteStrategy`; Surge and sing-box retain their own overrides. Rule source configuration does not switch either behavior per source.

Service subscriptions use `specialRules` to merge complementary blackmatrix7 Surge rules and MetaCubeX text geosite categories. Netflix also merges MetaCubeX geoip CIDRs; WeChat remains a single blackmatrix7 source. `smartConvertRule` normalizes numeric-leading domains and bare IPv4/IPv6 CIDRs before they enter the same canonical collections. A required source failure prevents publishing its merged ruleset; `sourceFiles` are complementary inputs, not fallback URLs.

## Upstream artifacts

Mirror sources use release adapters behind one artifact synchronization module. Release assets are filtered before download, validated before publication, and replaced through the shared atomic-file primitive, so a failed download or post-process keeps the last-known-good file. Add another adapter only when a production source requires one.

`SyncResult.failed` is the sole failure list for release mirrors. The CLI and summaries derive their counts and messages from it, so the reported failures match the required-failure decision. The fmz200 CLI uses the shared `task()` entry point once per invocation.

`NSRingo/Siri` is release-driven. The mirror accepts the `iRingo.Siri`, `iRingo.Search`, and `iRingo.Spotlight` asset families and does not build the upstream `dev` branch.

`tarball-utils` owns source selection and streaming transport for the previous-build and Sukka mock/module CLIs; extraction, filtering, category labels, and lifecycle remain with each CLI. Source inventory and health reports share URL redaction without changing source identity.

Source health probes carry the same request profile as their build source. Rule inputs use the Surge User-Agent, while GitHub release metadata uses the mirror User-Agent.

## Plugin artifacts

The runner downloads and validates fresh plugin bodies through the browser gateway, then serves only those bodies on loopback. A pinned Script-Hub container uses host networking to convert the staged inputs, keeping canonical upstream identity in the results. A version-checked parser patch preserves Loon v2 regex literals, URL capture replacements, header replacements, and static or text-file mock responses. jq_file and Kelee mock_file dependencies use the gateway. All script dependencies, including existing URLs on our own host, must be present in this run. Optional historical artifacts are restored only after fresh required inputs pass merging, without overwriting current outputs or changing conversion results. Source script dependencies must survive conversion; unsupported Loon v2 actions fail instead of passing through the legacy fallback as empty modules.

Plugin conversions remain pending until every required script has a mirrored or cached URL. Canonical source identity follows each plugin through remote conversion, local fallback, cache, and publication. Publication reports `ready`, `degraded`, or `failed`, uses the shared atomic-file primitive, and prevents same-name plugins from sharing cached bytes.

Script extraction retains the source URL. The publication URL is chosen from the completed mirror map after downloading or cache fallback, rather than stored before those outcomes are known.

The standalone CLI requires every result to be `ready`. CI explicitly supplies the merge configuration and verifies every enabled input against the current ready results and dry-run merging. Optional failures remain failed in the conversion report; missing required inputs cannot be replaced by previous NRRule artifacts in a run that requested conversion.

## CI task plan

The workflow's `prepare` job emits one `tasks` plan. Downstream jobs run from membership in that plan; the Build job owns mirror sync. A manual `mirror-sync` run therefore includes Build without deployment, while manual `deploy` builds and validates a fresh artifact before publishing it on `main`.

## Public index

`Build/lib/public-index-model.ts` owns rule aggregation, client metadata, visible-file semantics, and deterministic ordering. `Build/build-public.ts` owns HTML and browser behavior and does not mutate the model input.

## Current scope

The current codebase no longer parses raw adblock filter syntax into rules. It consumes upstream rule files and forwards normalized rule-set output by target platform.

Historical adblock parsing code and unused output variants have been removed to keep the build path small and easier to audit.

## Attribution

The project derives part of its build and rule-output code from [SukkaW/Surge](https://github.com/SukkaW/Surge). SukkaW/Surge is licensed under AGPL-3.0; MirrRule is also distributed under AGPL-3.0.

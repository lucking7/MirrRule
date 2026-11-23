# MirrRule

Aggregates and distributes network proxy rules from multiple upstream sources, automatically built and deployed via GitHub Actions.

MirrRule is the source repository name. Generated artifacts are published for the NRRule service at `https://nrrule.pages.dev`.

## Supported Platforms

| Platform | Rule Format | Directory |
|---|---|---|
| **Surge** | `.conf` (DOMAIN-SET or RULE-SET by directory), `.list` (RULE-SET) | `List/` |
| **Clash** | `.txt` (domain or classical provider by directory) | `Clash/` |
| **Loon** | `.list` (Rule) | `Loon/` |
| **sing-box** | `.json` (rule-set) | `sing-box/` |

The four platform roots contain merged subscriptions. The directories below each root provide the formats described in [Subscription Variants](#subscription-variants).

## Usage

Base URL:

```
https://nrrule.pages.dev
```

Example subscription URLs:

```
# Surge
https://nrrule.pages.dev/List/reject.list
https://nrrule.pages.dev/List/direct.list
https://nrrule.pages.dev/List/stream.list

# Clash
https://nrrule.pages.dev/Clash/reject.txt
https://nrrule.pages.dev/Clash/direct.txt

# Loon
https://nrrule.pages.dev/Loon/reject.list
https://nrrule.pages.dev/Loon/direct.list

# sing-box
https://nrrule.pages.dev/sing-box/reject.json
https://nrrule.pages.dev/sing-box/direct.json
```

Full file listing available at: https://nrrule.pages.dev

`wechat` (blackmatrix7 WeChat) is the only WeChat subscription. It includes blackmatrix7's `USER-AGENT` rules, so in-app browser traffic with a WeChat User-Agent matches it as well, and Tencent's AS132203 for connections made directly to IP addresses. `wechat_no_ua` was retired on 2026-11-15 because its NobyDa source had not changed since 2023 and let WeChat connections fall through to `FINAL`; its URLs return 404.

## Subscription Variants

The split paths use each client's native format. Choose the URL and configuration together. The table describes classification by rule type; the source-based split for `reject` is described below.

| Subscription | Surge | Clash / Mihomo (text) | sing-box (source JSON v2) | Loon |
|---|---|---|---|---|
| Exact domains and suffixes | `List/domainset/<id>.conf` · DOMAIN-SET | `Clash/domainset/<id>.txt` · `behavior: domain` | `sing-box/domainset/<id>.json` | Use the classical subscription |
| Non-IP conditions | `List/non_ip/<id>.conf` · RULE-SET | `Clash/non_ip/<id>.txt` · `behavior: classical` | `sing-box/non_ip/<id>.json` | `Loon/non_ip/<id>.list` |
| Destination-IP conditions | `List/ip/<id>.conf` · RULE-SET | `Clash/ip/<id>.txt` · `behavior: classical` | `sing-box/ip/<id>.json` | `Loon/ip/<id>.list` |

Use `domainset` for the explicit exact hosts and suffixes that survive normalization in `non_ip`. For example, a suffix appears as `.example.com` in Surge, `+.example.com` in Clash and a `domain_suffix` entry in sing-box. To load the full ruleset use the merged file, or the published `non_ip` and `ip` files together. The domains also appear in `non_ip`, which includes keywords, wildcards and other non-IP conditions. Adding `domainset` to that combination is redundant. NRRule keeps its own ruleset IDs and sources. Sukka's directory names identify the same client formats but each site's contents depend on its sources.

The deprecated regional `speedtest_china` and `speedtest_international` snapshots retain only their historical URLs. The active global `speedtest` gets the new formats. A Surge ruleset that requires file-wide `extended-matching` has no native domain set.

The existing merged URLs (for example `List/apple_cdn.list`) and Surge split URLs ending in `.list` continue to serve RULE-SET files. The Surge native domain set uses `.conf`. On Clash, configure a domain provider when using a new `Clash/domainset/` URL, including a URL you used before that directory was retired in October.

In Surge, load every `non_ip` variant before every `ip` variant. Rules in `ip` without `no-resolve` make Surge resolve the domain locally, so `ip` variants must come after all domain rules; `no-resolve` rules in `ip` match only connections made directly to an IP address. For Sukka sources, whether a rule carries `no-resolve` follows upstream; the service rulesets (netflix, disney, spotify, primevideo, youtube, bilibili, tiktok, wechat, google, github) and `emby` add `no-resolve` to every IP rule. The merged file of a ruleset with resolving IP rules (for example `cdn` or `reject`) contains those rules too: in Surge, place it after all domain rules, or add `no-resolve` to its rule-set line. Surge logical rules that mix a domain sub-condition with a destination-IP condition stay in `non_ip` when the ruleset uses `extended-matching`, so the file-wide flag still applies to them; the audit records their count as `reroutedFromIp`, and other platforms put those rules in `ip`.

The sing-box format drops Surge’s `no-resolve` modifier. Because `reject` is split by upstream file, `sing-box/non_ip/reject.json` can contain `ip_cidr`. For DNS filtering by query name, select the domain fields you need, including `domain_keyword` and `domain_regex` when those matches matter. To filter by an address in the DNS answer in sing-box 1.14+, use the `evaluate` action followed by a rule with `match_response: true`. [sing-box DNS migration guide](https://sing-box.sagernet.org/migration/#migrate-address-filter-fields-to-response-matching)

Platform conversion can lose modifiers or values. sing-box cannot express `no-resolve`, platforms other than Surge ignore `extended-matching`, and Clash drops `PROTOCOL` values other than TCP and UDP. Each loss is counted in `outputs[].losses` of the output audit.

A variant with no conditions, or whose conditions the platform cannot express, is not published as a file; requesting it returns 404. Check `Internal/rule-output-audit.json` before subscribing: for each ruleset, variant and platform it lists the format, path, status (`published`, `absent-empty` or `absent-unsupported`), effective condition count, bytes and SHA-256.

Surge:

```ini
[Rule]
# non_ip goes where the merged subscription was:
RULE-SET,https://nrrule.pages.dev/List/non_ip/<id>.conf,POLICY
# ... other domain rules ...
# ip, when published, goes after all domain rules:
RULE-SET,https://nrrule.pages.dev/List/ip/<id>.conf,POLICY
```

For a domain-only Surge subscription, use `DOMAIN-SET,https://nrrule.pages.dev/List/domainset/speedtest.conf,DIRECT`.

Clash (Mihomo):

```yaml
rule-providers:
  speedtest_domains:
    type: http
    behavior: domain
    format: text
    url: https://nrrule.pages.dev/Clash/domainset/speedtest.txt
    path: ./rules/speedtest_domains.txt
    interval: 86400
rules:
  - RULE-SET,speedtest_domains,DIRECT
```

Loon:

```ini
[Remote Rule]
https://nrrule.pages.dev/Loon/apple_cdn.list, policy=DIRECT, tag=Apple CDN, enabled=true
```

Loon 3.0.3 and later match domain rules first. If none matches, Loon resolves the name and tests IP rules. Use the merged subscription for a single policy. Choose the split files to assign different policies to domain and IP rules. [Loon rule priority](https://nsloon.app/docs/Rule/)

sing-box:

```json
{
  "route": {
    "rule_set": [
      { "type": "remote", "tag": "apple_cdn-non_ip", "format": "source", "url": "https://nrrule.pages.dev/sing-box/non_ip/apple_cdn.json" }
    ],
    "rules": [
      { "rule_set": ["apple_cdn-non_ip"], "outbound": "direct" }
    ]
  }
}
```

Whether a ruleset has an `ip` variant follows upstream and can change: if you load only `non_ip/<id>`, a later `ip/<id>` is not loaded, and you cannot reference it in advance because a missing variant returns 404. Check your profile against the current audit with `pnpm run node Build/check-profile-variants.ts --profile <profile.conf>`. It checks the exact URLs you load and lists missing parts of a non_ip/ip subscription, and exits 1 when it finds either; `--audit` takes a local audit file instead of the production one.

A ruleset without an `ip` variant can also stay as the merged subscription in a single line. Equal condition sets do not guarantee the same policy outcome once the variants are rearranged: an `ip` variant can hold logical rules with a domain child, and moving it later delays that domain match. Use the same policy for both variants of a ruleset unless its notes below say otherwise (see `reject`), and review cross-subscription reordering with the coverage audit below.

## Routing Coverage Audit

Every successful rules build publishes `Internal/rule-coverage.json`, an audit of the documented example subscription order. It reports earlier exact/suffix domain coverage, distinguishes different-policy conflicts from same-policy redundancy, and warns about broad User-Agent/process conditions. This report describes the example order, not the configuration loaded by every subscriber. Unavailable sources and unsupported predicates remain explicit gaps; a report does not prove complete routing correctness.

Profile audits resolve NRRule subscriptions below `--rules-dir` using the formats in the table above. Local `DOMAIN-SET` files also use the native parser. Each subscription entry records its `format`, `variant` and `reviewStatus`. A reference that cannot be resolved is reported as `not-covered` with a `notCoveredReason`, never as reviewed: an absent variant (status read from `Internal/rule-output-audit.json` next to the rules directory, or from `--output-audit`), a `RULE-SET`/`DOMAIN-SET` format mismatch, an unknown NRRule path, or any other remote URL. Missing files, absent variants and format mismatches make the CLI exit 1.

```bash
pnpm run audit:coverage -- --rules-dir public/List --output /tmp/rule-coverage.json
pnpm run audit:coverage -- --profile /path/to/effective-profile.conf --rules-dir public/List --output /tmp/profile-coverage.json
```

For module-aware results, supply a Surge effective profile containing the enabled module rules. The audit reads only its `[Rule]` section, does not fetch remote sources, and maps NRRule subscription URLs to the supplied rules directory. Resolve relative local rule files from the supplied profile's directory. Keep effective profiles private; audit JSON contains rule evidence and policy names but excludes other profile sections. `--fail-on-full-shadow` fails when an entire subscription is proven unreachable, rather than treating every intentional overlap as an error.

## File Index

The homepage is a native directory tree following the layout and styling of [Sukka Ruleset Server](https://ruleset.skk.moe/), with NRRule / Luck branding and MirrRule's own files and URLs. Open the appropriate client directory, then open a file or use the browser's copy-link action to obtain its subscription URL. Root directories start expanded, except `Mock` and `Internal`; nested directories start collapsed.

The index uses system fonts and follows the system light or dark appearance. Its heading is `NRRule Ruleset Server`, `Made by Luck` links to [lucking7](https://github.com/lucking7), and `Source @ GitHub` links to this repository. Product and styling requirements are recorded in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

Netflix, Disney, Spotify, Prime Video, YouTube, BiliBili, TikTok, Google and GitHub use [MetaCubeX domain rules](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite). Netflix also includes the [MetaCubeX Netflix IP ranges](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geoip). Google includes [Google's published ranges](https://www.gstatic.com/ipranges/goog.json) minus its [Google Cloud customer ranges](https://www.gstatic.com/ipranges/cloud.json), so sites hosted on Google Cloud are not routed as Google. BiliBili includes the international `biliintl` category. MetaCubeX lacks some domains that blackmatrix7 had (Prime Video video CDNs, BiliBili PCDN hosts, TikTok/CapCut overseas domains), so that traffic no longer matches these rulesets. WeChat uses [blackmatrix7 Surge rules](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Surge) alone, since MetaCubeX has no WeChat category. Existing subscription filenames remain unchanged. See [规则来源与迁移记录](RULE_SOURCES.md) for source mappings, format conversion, CDN/speedtest coverage, and verification limits.

## Rule Sets

| Rule Set | Description |
|---|---|
| `reject` | Ad blocking and privacy protection |
| `my_reject` | Optional Sukka personal blocking rules; review before enabling |
| `reject-no-drop` | Ad blocking (no connection drop) |
| `reject-drop` | Ad blocking (drop connection) |
| `direct` | Direct connection without proxy |
| `stream` | Streaming services (all regions) |
| `telegram` | Telegram |
| `youtube` | YouTube |
| `spotify` | Spotify |
| `tiktok` | TikTok |
| `wechat` | WeChat |
| `apple` | Combined Apple CDN, China, services, services IP ranges, and iCloud Private Relay |
| `apple_cdn` | Apple download CDN |
| `apple_cn` | Apple services available in China |
| `apple_services`, `apple_services_ip` | Apple service rules and separate service IP ranges |
| `icloud_private_relay` | iCloud Private Relay |
| `microsoft` | Microsoft services |
| `microsoft_cdn` | Microsoft download CDN, also included in `microsoft` |
| `google` | Google domains and the network prefixes Google operates for its own services, excluding Google Cloud customer addresses. Use `non_ip/google` for domain routing or `ip/google` for the network prefixes. |
| `amazon` | Domains for Amazon, AWS, Prime Video, Kindle, IMDb, and related services. Put any separate Prime Video policy first. |
| `domestic` | China domestic sites |
| `lan` | Local network |
| `speedtest` | Global speed-test domains, updated from Sukka’s published domain set |
| `speedtest_china`, `speedtest_international` | Frozen regional subscriptions. Existing URLs serve the rules accepted on 2026-11-19 |
| `apple_intelligence` | Apple Intelligence and Apple Relay |
| `game_download` | Game download CDNs outside China |
| `stream_us`, `stream_hk`, `stream_jp`, `stream_tw`, `stream_kr`, `stream_eu` | Regional streaming domain and application rules |
| `reject_phishing` | Phishing domain blocking |
| `reject_url_regex` | Optional URL blocking, Surge only; HTTPS matching requires MITM |
| `domestic_cdn` | Domestic CDN routing for users outside China |
| `gitlab` | GitLab |
| `sogouinput` | Sogou Input privacy blocking |
| `cloudmounter` | CloudMounter / RaiDrive conditions, Surge only |

Additional Sukka categories retain separate subscriptions so clients can assign their own policies. The aggregate `stream` also includes all six regional collections, while `reject_extra` is Sukka's extended blocking set only; phishing domains are published separately as `reject_phishing`. `cloudmounter` is available only as a Surge ruleset; its AND/process/source-IP conditions are retained. See [规则来源与迁移记录](RULE_SOURCES.md#sukka-补充分类) for source paths, routing guidance, and compatibility.

Apple subscriptions are available both separately and in `apple`. Keep `apple_intelligence` separate and place it before broader Apple or AI rules when assigning a dedicated exit. Put other specific Apple or Microsoft CDN subscriptions before their aggregate rules, and service IP subscriptions after domain rules. Telegram combines domain, active Teleproto IP, and ASN sources; sing-box omits ASN rules under the existing conversion matrix.

`china_asn` is available for Surge, Clash, and Loon. sing-box has no ASN matcher, so use the separate `china_ip` / `china_ip_ipv6` subscriptions when IP-based China routing is appropriate; their coverage is not equivalent to ASN matching. The former `sing-box/china_asn.json` is retired (see [Retired Subscriptions](#retired-subscriptions)). Builds refuse to publish sing-box files without an effective matching condition.

`reject` merges Sukka's base domain, non-IP, and IP blocking sources. Its IP rules keep the upstream `no-resolve` choice per rule, so most of them match a domain's resolved address. Its variants follow the upstream files, not a split of the merged rules by type: `non_ip/reject` combines upstream `domainset/reject` and `non_ip/reject` (including the IP rules upstream keeps there, all with `no-resolve`), and `ip/reject` is upstream `ip/reject`. Surge users who bind the IP rules to a different policy should load `non_ip/reject` with REJECT ahead of other domain rules, and `ip/reject` with REJECT-DROP after all domain rules. A client that loads the merged file ahead of its domain rules should add `no-resolve` to that rule-set line; otherwise every request is resolved locally before the domain rules run. `my_reject` is a separate optional subscription containing Sukka's personal choices, including finance, video, push, software validation, process, and port rules. Review it before enabling; Surge users should bind it to REJECT-DROP as indicated upstream. Other platforms retain only supported rule types and do not guarantee equivalent connection handling. A logical expression with an unsupported, unknown or malformed child is rejected as a whole, with a drop reason; removing only that child would change its matching semantics.

`reject_url_regex` remains separate from general blocking rules. Subscribe only when URL-level blocking is needed and bind it to REJECT in Surge. For HTTPS matching, enable and trust the Surge MITM certificate, then load the mirrored [Sukka MITM hostname module](https://nrrule.pages.dev/Mirror/Sukka/sgmodule/sukka_mitm_hostnames.sgmodule). This source does not generate Clash, Loon, or sing-box files. Empty regional streaming IP sources and deprecated Sukka aliases are excluded.

## Surge Modules

Mirrored Surge modules from [iRingo](https://github.com/NSRingo), [DualSubs](https://github.com/DualSubs), [BiliUniverse](https://github.com/BiliUniverse), and [GetSomeFries](https://github.com/VirgilClyne/GetSomeFries) (ASN China, DNS, General) are available under `Mirror/`.

## Retired Subscriptions

Deprecated and retired files are recorded in one registry, `Build/lib/artifact-lifecycle.ts`, and published as `Internal/artifact-lifecycle.json` with the reason, evidence and any replacement. A deprecated file is still published for compatibility; a retired file is removed from every build, cache restoration, retained directory and rollback candidate, and is not published again. A replacement is a note for manual migration; old URLs are not redirected. Retirement covers both merged and split paths. Browser responses require revalidation; publication checks use the original URLs, including retired paths, without cache-busting queries.

| Retired | Replacement |
|---|---|
| Tencent Video ad-removal plugin modules (`Modules/Converted/腾讯视频去广告.sgmodule`, `Tencent_Video_remove_ads.sgmodule`) | None; the upstream stopped maintenance |
| `Modules/Rules/reject-pro.list` (2026-11-16; a policy-stripped copy of the merged module's `[Rule]` section that mixed DIRECT exceptions into a block list) | `Modules/Merged/All-in-One-Pro.sgmodule`, whose `[Rule]` section keeps each rule's policy |
| `container`, `discord` and `scholar` rulesets on all four platforms | None; removed from rule sources |
| `sing-box/china_asn.json` | `sing-box/china_ip.json` and `sing-box/china_ip_ipv6.json`; IP coverage is not equivalent to ASN matching |
| iRingo Maps, TestFlight, Siri, Search and Spotlight mirrors under `Mirror/iRingo/` (2026-11-16; Apple pins the certificates they rewrite and NSRingo marks them as no longer working) | None |
| `streaming_cn` and `streaming_!cn` rulesets on all four platforms (2026-11-10; their only upstream, ConnersHua/RuleGo, is no longer maintained) | `streaming_!cn`: `stream` (Sukka), which covered 73.7% of it; `streaming_cn`: none |

## Update Schedule

Rules are automatically rebuilt and published on a schedule:

- **Full workflow run** (mirror sync + plugin conversion/module merge + rule build + publication): twice daily
- **Quick update** (rules only): every 4 hours
- **Mirror sync**: three times daily
- **Plugin conversion**: twice daily

## Build Reports

Each published build includes machine-readable reports under `Internal/`. Publication fails if `rule-output-audit.json`, `source-delta.json`, `rule-coverage.json`, `status.json` or `artifact-lifecycle.json` is missing or invalid, or if any published output differs from the bytes and SHA-256 recorded in the audit.

| File | Content |
|---|---|
| `Internal/publication-manifest.json` | Every published file with its path, bytes and SHA-256, plus the source revision |
| `Internal/rule-output-audit.json` | Format, path, status, effective count, bytes and SHA-256 for each output; optimization reasons and effective platform digests |
| `Internal/source-delta.json` | Added and removed upstream conditions compared with the last accepted publication; rulesets that existed in the baseline but are no longer built are listed as `removed`; `baseline-unavailable` on the first build, `not-comparable` when schema, converter or processing options changed |
| `Internal/source-snapshots/<sourceId>.json.gz` | Normalized source conditions and actual merged platform conditions, used for separate source and output comparisons |
| `Internal/artifact-lifecycle.json` | Deprecated and retired subscriptions with reason and replacement |
| `Internal/rule-coverage.json` | Cross-subscription coverage audit of the example order |
| `Internal/preserved-artifacts.json` | Optional modules and scripts restored from the accepted baseline; these files are marked `preserved` in the manifest |

`status.json` keeps its existing `ruleCount` meaning: the number of canonical conditions after processing, not the per-platform output count. Use `Internal/rule-output-audit.json` for the counts each platform actually publishes. Normalized source deltas have `semanticScope: normalized-source`; `effectiveOutputs` separately compare the actual merged output on each platform. A covered upstream domain can be removed while the output stays identical. `optimizations` records keyword coverage and domain coverage of wildcards between canonical storage and writer routing; it does not classify every earlier Trie or CIDR normalization step. Text output comparisons use condition sets, retaining complete logical expressions and modifiers; they do not audit rule order. sing-box digests retain rule-object boundaries. Banner and date changes do not change either semantic digest. A changed `no-resolve` flag changes source semantics and only those platform outputs that retain it. Older converter versions or snapshots without effective output data are explicitly not comparable for the affected comparison.

## Publication and Rollback

Production has one publication path. The workflow pushes the complete candidate to the NRRule repository, waits for the Cloudflare Pages Git integration check of that exact commit, and then verifies both the immutable deployment URL and `https://nrrule.pages.dev`. A publication is accepted only when both serve every manifest file with its SHA-256, and both return 404 for variants the audit lists as absent, for retired registry paths, and for baseline paths that are no longer published. The former direct Wrangler upload is removed. Only runs on `main` publish. For `workflow_dispatch`, the legacy `deploy_target` values `all`, `github` and `cloudflare` are still accepted and all mean production; `github` no longer means "repository only". The `build`, `mirror-sync`, `convert-plugins` and `merge-modules` tasks do not publish by themselves.

A run that pushed to NRRule but whose website check failed or timed out reports "Git published, website not accepted" and is not a successful publication. Each accepted publication is recorded as a GitHub Deployment in MirrRule (a receipt binding the source commit, NRRule commit, candidate, manifest SHA-256 and immutable URL). Builds compare source changes against the latest accepted receipt, not against the NRRule branch head. If a different receipt is accepted between the build and publication, staging recomputes source deltas from the candidate snapshots against that baseline, verifies and refreshes preserved assets, and regenerates the index and manifest without redownloading upstream sources. Invalid snapshots or restoration digests fail staging. The manifest retains an `originalCandidateId` derived from the original candidate inputs, so retrying that candidate after a rebase and acceptance ends as a no-op. Changed inputs or task context do not match. Historical manifests without this identity remain readable but cannot establish this retry shortcut.

Workflow artifacts have attempt-specific names. Downstream jobs consume the producing job's artifact ID, so rerunning only failed jobs can reuse an earlier successful producer's output. Diagnostic and bootstrap evidence from earlier attempts is retained rather than overwritten.

To publish merge configuration or merger code changes while the plugin catalog is unavailable, run `workflow_dispatch` with task `deploy-modules`. It remerges the converted modules from the accepted baseline, builds the rules, and uses the normal production publication and verification chain. Converted modules and scripts retain their accepted provenance; the merged module is generated anew. This task does not refresh plugin sources. If the accepted receipt changes before staging, or the copied converted modules change during the build, staging rejects the candidate before pushing; rebuild against the current baseline.

First rollout:

1. Merge the change.
2. Automatic push and schedule runs build but skip publication with the warning "publication skipped: bootstrap required". Manual `deploy` and `rollback` fail until a baseline exists.
3. Run `workflow_dispatch` with task `bootstrap-baseline`, the current NRRule commit as `bootstrap_revision`, and its Cloudflare immutable URL as `bootstrap_immutable_url`. This verifies the existing site and records a `legacy-bootstrap` receipt; it does not publish.
4. The next run publishes normally.

The bootstrap evidence artifact is kept for 90 days. If it expires before a normal publication replaces it, run `bootstrap-baseline` again; this creates a new receipt that replaces the old one. Retrying with the same evidence reuses the existing receipt.

Source comparison snapshots are stored losslessly as compact gzip JSON (`Internal/source-snapshots/*.json.gz`); readers also accept historical plain `.json` snapshots. Publication checks every asset against the Cloudflare Pages 25 MiB file limit before pushing. The final publication tree generates a Pages Worker for `/Internal/*` and exact paths in the retirement registry: it forwards active internal artifacts and returns an uncached 404 for removed internal artifacts and retired subscriptions before static asset lookup. The Pages project must use Functions fail-closed mode (`fail_open: false`) so quota exhaustion cannot bypass this check.

To roll back, run the workflow with task `rollback` and `rollback_receipt_id` set to an accepted publication receipt (bootstrap receipts cannot be rolled back to). The workflow starts from that accepted tree, applies the current retirement registry, and publishes the result as a new NRRule commit through the same check and acceptance steps. Historical output audits and source snapshots are projected to the remaining subscriptions before validation; removed output metadata is retained separately in `retiredOutputs`, not counted as current published outputs. A rollback never restores retired files.

## Development

中文迁移与从零搭建指南：[MIGRATION.md](./MIGRATION.md)，包含环境安装、功能与数据流、账号和域名替换、CI 部署、验收记录及回滚步骤。

全项目清理的候选、保留理由和验证记录：[SIMPLIFICATION.md](./SIMPLIFICATION.md)。

Requires **Node.js 26.x** and **pnpm 10.x**.

```bash
pnpm install
pnpm run validate
pnpm test
pnpm run knip
pnpm run build
```

- `pnpm run validate` runs lint and typecheck.
- `pnpm test` runs Node's test runner for `Build/__tests__/*.test.ts`.
- `pnpm run knip` checks for unused code and dependencies.
- `pnpm run build` builds the rule artifacts only (GEOIP download + rule processing + web index generation); mirror sync, plugin conversion and module merging are separate scripts (`sync-mirrors`, `convert-plugins`, `merge-modules`) orchestrated by CI. It downloads upstream assets and writes generated files under `public/**`, so only run it when you intend to produce those artifacts.

Plugin conversion downloads and validates fresh inputs before serving them on loopback to Script-Hub. The CI container uses host networking and supports Loon v2; setup and local Linux instructions are in [MIGRATION.md](./MIGRATION.md#52-插件转换). The default CLI requires every conversion to be ready. CI explicitly verifies all enabled merge inputs against fresh ready results and dry-run merging; optional failures remain visible in its conversion report. Valid previous optional subscriptions and scripts are retained after fresh required modules pass merging.

Local Loon fallback retains five- or six-field cron expressions, including lists, ranges, steps and month/weekday aliases. Missing, invalid or locally unsupported expressions fail conversion instead of producing an unscheduled ready script. Release mirrors validate UTF-8, reject HTML error pages and check each platform format before atomic replacement; native modules receive structural checks rather than conversion-specific dependency comparisons.

The designated `Prevent_DNS_Leaks` source is published as `DNS防泄露.sgmodule` with `#!arguments=policy:Proxy`. Change `policy` in the module parameter table to an existing policy group. It routes only the listed DNS/IP test sites; it does not guarantee that all DNS traffic avoids leaks. The adapter rejects unexpected source sections, policies, or actions instead of publishing a partial module.

Module merging uses `Build/lib/module-merger/configs/pro-merge-config.yaml` and writes one file, `Modules/Merged/All-in-One-Pro.sgmodule`, by staging it next to the destination and renaming it. Its `[Rule]` section is the only rule output. Every selected input must load and contain usable sections; missing inputs, undefined parameters, and unknown selection ids fail the command before publication. `--dry-run` performs the same validation without writing files.

Every merged module has a switch named after its `id` in the config (for example `amap`, `sf_express`, `wechat_mp`). Leave it **empty to enable** the module or enter **`#` to disable** it. Modules marked `defaultOff: true` in the config (rarely used apps) start as `#`; disabling comments out all of that module's lines in `[Rule]`, `[URL Rewrite]`, `[Header Rewrite]`, `[Body Rewrite]`, `[Map Local]` and `[Script]`. Each module has only this one switch; its scripts run whenever the module is enabled. Use an empty value instead of `1` so a source module's own script switches can still disable individual scripts. The parameter description in Surge lists every switch with its module name. Switch names changed from the Chinese module names to these ASCII ids on 2026-11-16, and the separate `<id>_script` switches were removed the same day, so values set under the old names no longer apply.

MITM hostnames are always the union of all modules and do not follow the switches. Excluding a hostname with `-host` would also break any other enabled module that needs it.

Rules are deduplicated only within one module, so disabling one module never removes a rule that another module also needs. Source parameter prefixes are preserved on logical rules and participate in deduplication with their case-sensitive names, so independently switched rules remain independent. Merged rules keep built-in policies (DIRECT and the REJECT variants) and parameterized policies; a rule without a policy gets REJECT. A rule with any other policy, such as `PROXY` or a policy group name, is dropped with a build warning, because Surge reports a module rule with an unknown policy as an error.

Imported parameters retain their defaults and descriptions under per-source names. Script names are unique across sources and within each source; Panel references follow the renamed scripts.

The default merge configuration includes all 46 entries; each module's initial switch value follows `defaultOff`. Tencent Video has been removed from conversion and merging because its upstream explicitly discontinued maintenance; historical converted artifacts are also excluded from restoration and publication through the lifecycle registry (see [Retired Subscriptions](#retired-subscriptions)). The retired subscription filenames are reserved; an active replacement must use a different module name. EasyBike remains tracked because its upstream has no retirement notice, but its required `mobileconfig-gateway.js` returns HTTP 404 (checked 2026-10-08), so fresh conversion still fails. DiDi uses the switch `didi` and the current `滴滴去广告.sgmodule` filename.

The downloaded GeoIP databases are checked for MMDB metadata and sampled record readability before replacement; see [the GeoIP validation contract](./RULE_SOURCES.md#下载的-geoip-库).

## License

[GNU Affero General Public License v3.0](./LICENSE)

This project derives part of its build and rule-output code from [SukkaW/Surge](https://github.com/SukkaW/Surge), which is licensed under AGPL-3.0. MirrRule keeps the same AGPL-3.0 license and preserves attribution here.

The directory index styling and tree layout are copied or adapted from the same project's [index generator](https://github.com/SukkaW/Surge/blob/6373d9aca136bf6b8f4ad091baebf50a8f088d4a/Build/build-public.ts). See [Build/assets/README.md](Build/assets/README.md) for the source revision and license reference.

Upstream rule data also comes from [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) and [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat). Their repositories retain their own licenses and attribution.

The pinned Script-Hub parser fixture in `Build/__tests__/fixtures/` comes from [Script-Hub-Org/Script-Hub](https://github.com/Script-Hub-Org/Script-Hub/tree/1ab8fd775a9028b70ede9009d0540818edd5882c), under GPL-3.0. Its license is included in [script-hub-LICENSE.txt](Build/__tests__/fixtures/script-hub-LICENSE.txt).

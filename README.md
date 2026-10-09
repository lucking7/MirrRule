# MirrRule

Aggregates and distributes network proxy rules from multiple upstream sources, automatically built and deployed via GitHub Actions.

MirrRule is the source repository name. Generated artifacts are published for the NRRule service at `https://nrrule.pages.dev`.

## Supported Platforms

| Platform | Rule Format | Directory |
|---|---|---|
| **Surge** | `.list` (RULE-SET) | `List/` |
| **Clash** | `.txt` (classical ruleset) | `Clash/` |
| **Loon** | `.list` (Rule) | `Loon/` |
| **sing-box** | `.json` (rule-set) | `sing-box/` |

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

Use `https://nrrule.pages.dev/List/wechat_no_ua.list` for WeChat-specific routing without letting every request with a WeChat User-Agent bypass earlier service or blocking policies. This variant follows NobyDa's maintained source during normal builds, retains supported domain/IP conditions, and excludes entire logical expressions containing `USER-AGENT`. The original `wechat` subscription is unchanged. Clash, Loon, and sing-box variants use the same basename and their usual directory/extension; supported rule types still differ by client.

## Routing Coverage Audit

Every successful rules build publishes `Internal/rule-coverage.json`, an audit of the documented example subscription order. It reports earlier exact/suffix domain coverage, distinguishes different-policy conflicts from same-policy redundancy, and warns about broad User-Agent/process conditions. This report describes the example order, not the configuration loaded by every subscriber. Unavailable sources and unsupported predicates remain explicit gaps; a report does not prove complete routing correctness.

```bash
pnpm run node Build/audit-rule-coverage.ts --rules-dir public/List --output /tmp/rule-coverage.json
pnpm run node Build/audit-rule-coverage.ts --profile /path/to/effective-profile.conf --rules-dir public/List --output /tmp/profile-coverage.json
```

For module-aware results, supply a Surge effective profile containing the enabled module rules. The audit reads only its `[Rule]` section, does not fetch remote sources, and maps NRRule subscription URLs to the supplied rules directory. Resolve relative local rule files from the supplied profile's directory. Keep effective profiles private; audit JSON contains rule evidence and policy names but excludes other profile sections. `--fail-on-full-shadow` fails when an entire subscription is proven unreachable, rather than treating every intentional overlap as an error.

## File Index

The homepage is a native directory tree following the layout and styling of [Sukka Ruleset Server](https://ruleset.skk.moe/), with NRRule / Luck branding and MirrRule's own files and URLs. Open the appropriate client directory, then open a file or use the browser's copy-link action to obtain its subscription URL. Root directories start expanded, except `Mock` and `Internal`; nested directories start collapsed.

The index uses system fonts and follows the system light or dark appearance. Its heading is `NRRule Ruleset Server`, `Made by Luck` links to [lucking7](https://github.com/lucking7), and `Source @ GitHub` links to this repository. Product and styling requirements are recorded in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

Service subscriptions merge [blackmatrix7 Surge rules](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Surge) with available [MetaCubeX text geosite rules](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite). Netflix also includes MetaCubeX's IP ranges; WeChat uses blackmatrix7 alone. Existing subscription filenames remain unchanged. See [规则来源与迁移记录](RULE_SOURCES.md) for source mappings, format conversion, CDN/speedtest coverage, and verification limits.

## Rule Sets

| Rule Set | Description |
|---|---|
| `reject` | Ad blocking and privacy protection |
| `my_reject` | Optional Sukka personal blocking rules; review before enabling |
| `reject-no-drop` | Ad blocking (no connection drop) |
| `reject-drop` | Ad blocking (drop connection) |
| `direct` | Direct connection without proxy |
| `stream` | Streaming services (all regions) |
| `streaming_cn` | Streaming services (China) |
| `streaming_!cn` | Streaming services (international) |
| `telegram` | Telegram |
| `youtube` | YouTube |
| `spotify` | Spotify |
| `tiktok` | TikTok |
| `wechat` | WeChat |
| `wechat_no_ua` | Automatically updated NobyDa WeChat rules without broad User-Agent bypass |
| `apple` | Combined Apple CDN, China, services, services IP ranges, and iCloud Private Relay |
| `apple_cdn` | Apple download CDN |
| `apple_cn` | Apple services available in China |
| `apple_services`, `apple_services_ip` | Apple service rules and separate service IP ranges |
| `icloud_private_relay` | iCloud Private Relay |
| `microsoft` | Microsoft services |
| `microsoft_cdn` | Microsoft download CDN, also included in `microsoft` |
| `amazon` | Amazon, AWS, Prime Video, Kindle, IMDb, and related services |
| `domestic` | China domestic sites |
| `lan` | Local network |
| `speedtest` | Speedtest servers |
| `apple_intelligence` | Apple Intelligence and Apple Relay |
| `game_download` | Game download CDNs outside China |
| `stream_us`, `stream_hk`, `stream_jp`, `stream_tw`, `stream_kr`, `stream_eu` | Regional streaming domain and application rules |
| `reject_phishing` | Phishing domain blocking |
| `reject_url_regex` | Optional URL blocking, Surge only; HTTPS matching requires MITM |
| `domestic_cdn` | Domestic CDN routing for users outside China |
| `gitlab` | GitLab |
| `sogouinput` | Sogou Input privacy blocking |
| `cloudmounter` | CloudMounter / RaiDrive conditions, Surge only |

Additional Sukka categories retain separate subscriptions so clients can assign their own policies. The aggregate `stream` also includes all six regional collections, and `reject_extra` includes phishing rules. `cloudmounter` is available only as a Surge ruleset; its AND/process/source-IP conditions are retained. See [规则来源与迁移记录](RULE_SOURCES.md#sukka-补充分类) for source paths, routing guidance, and compatibility.

Apple subscriptions are available both separately and in `apple`. Keep `apple_intelligence` separate and place it before broader Apple or AI rules when assigning a dedicated exit. Put other specific Apple or Microsoft CDN subscriptions before their aggregate rules, and service IP subscriptions after domain rules. Telegram combines domain, active Teleproto IP, and ASN sources; sing-box omits ASN rules under the existing conversion matrix.

`china_asn` is available for Surge, Clash, and Loon. sing-box has no ASN matcher, so use the separate `china_ip` / `china_ip_ipv6` subscriptions when IP-based China routing is appropriate; their coverage is not equivalent to ASN matching. Builds refuse to publish sing-box files without an effective matching condition.

`reject` merges Sukka's base domain, non-IP, and IP blocking sources. `my_reject` is a separate optional subscription containing Sukka's personal choices, including finance, video, push, software validation, process, and port rules. Review it before enabling; Surge users should bind it to REJECT-DROP as indicated upstream. Other platforms retain only supported rule types and do not guarantee equivalent connection handling.

`reject_url_regex` remains separate from general blocking rules. Subscribe only when URL-level blocking is needed and bind it to REJECT in Surge. For HTTPS matching, enable and trust the Surge MITM certificate, then load the mirrored [Sukka MITM hostname module](https://nrrule.pages.dev/Mirror/Sukka/sgmodule/sukka_mitm_hostnames.sgmodule). This source does not generate Clash, Loon, or sing-box files. Empty regional streaming IP sources and deprecated Sukka aliases are excluded.

## Surge Modules

Mirrored Surge modules from [iRingo](https://github.com/NSRingo), [DualSubs](https://github.com/DualSubs), and [BiliUniverse](https://github.com/BiliUniverse) are available under `Mirror/`.

## Update Schedule

Rules are automatically rebuilt and deployed on a schedule:

- **Full workflow run** (mirror sync + plugin conversion/module merge + rule build + deployment): twice daily
- **Quick update** (rules only): every 4 hours
- **Mirror sync**: three times daily
- **Plugin conversion**: twice daily

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

The designated `Prevent_DNS_Leaks` source is published as `DNS防泄露.sgmodule` with `#!arguments=policy:Proxy`. Change `policy` in the module parameter table to an existing policy group. It routes only the listed DNS/IP test sites; it does not guarantee that all DNS traffic avoids leaks. The adapter rejects unexpected source sections, policies, or actions instead of publishing a partial module.

Module merging uses `Build/lib/module-merger/configs/pro-merge-config.yaml`. Every selected input must load and contain usable sections; missing inputs, undefined parameters, and unknown selection keys fail the command before publication. `--dry-run` performs the same validation without writing files. Outputs are staged in both destination directories, replaced by rename, and restored if a later replacement fails.

Imported parameters retain their defaults and descriptions under per-source names. Script names are unique across sources and within each source; Panel references follow the renamed scripts. For the generated module script switches, leave the value **empty to enable** or enter **`#` to disable**. Use an empty value instead of `1` so a source module's own script switches can still disable individual scripts.

The default configuration enables all 47 entries. Tencent Video has been removed from conversion and merging because its upstream explicitly discontinued maintenance; historical converted artifacts are also excluded from restoration and publication. The retired subscription filenames are reserved; an active replacement must use a different module name. EasyBike remains tracked because its upstream has no retirement notice, but its required `mobileconfig-gateway.js` returns HTTP 404 (checked 2026-10-08), so fresh conversion still fails. DiDi retains its existing switch name and uses the current `滴滴去广告.sgmodule` filename.

## License

[GNU Affero General Public License v3.0](./LICENSE)

This project derives part of its build and rule-output code from [SukkaW/Surge](https://github.com/SukkaW/Surge), which is licensed under AGPL-3.0. MirrRule keeps the same AGPL-3.0 license and preserves attribution here.

The directory index styling and tree layout are copied or adapted from the same project's [index generator](https://github.com/SukkaW/Surge/blob/6373d9aca136bf6b8f4ad091baebf50a8f088d4a/Build/build-public.ts). See [Build/assets/README.md](Build/assets/README.md) for the source revision and license reference.

Upstream rule data also comes from [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) and [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat). Their repositories retain their own licenses and attribution.

The pinned Script-Hub parser fixture in `Build/__tests__/fixtures/` comes from [Script-Hub-Org/Script-Hub](https://github.com/Script-Hub-Org/Script-Hub/tree/1ab8fd775a9028b70ede9009d0540818edd5882c), under GPL-3.0. Its license is included in [script-hub-LICENSE.txt](Build/__tests__/fixtures/script-hub-LICENSE.txt).

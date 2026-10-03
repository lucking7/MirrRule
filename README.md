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

Service subscriptions merge [blackmatrix7 Surge rules](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Surge) with available [MetaCubeX text geosite rules](https://github.com/MetaCubeX/meta-rules-dat/tree/meta/geo/geosite). Netflix also includes MetaCubeX's IP ranges; WeChat uses blackmatrix7 alone. Existing subscription filenames remain unchanged. See [规则来源与迁移记录](RULE_SOURCES.md) for source mappings, format conversion, CDN/speedtest coverage, and verification limits.

## Rule Sets

| Rule Set | Description |
|---|---|
| `reject` | Ad blocking and privacy protection |
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
| `apple` | Apple services |
| `microsoft` | Microsoft services |
| `amazon` | Amazon, AWS, Prime Video, Kindle, IMDb, and related services |
| `domestic` | China domestic sites |
| `lan` | Local network |
| `speedtest` | Speedtest servers |
| `apple_intelligence` | Apple Intelligence and Apple Relay |
| `game_download` | Game download CDNs outside China |
| `stream_us`, `stream_hk`, `stream_jp`, `stream_tw`, `stream_kr`, `stream_eu` | Regional streaming domains and IP ranges |
| `reject_phishing` | Phishing domain blocking |
| `domestic_cdn` | Domestic CDN routing for users outside China |
| `gitlab` | GitLab |
| `sogouinput` | Sogou Input privacy blocking |
| `cloudmounter` | CloudMounter / RaiDrive conditions, Surge only |

Additional Sukka categories retain separate subscriptions so clients can assign their own policies. The aggregate `stream` also includes all six regional collections, and `reject_extra` includes phishing rules. `cloudmounter` is available only as a Surge ruleset; its AND/process/source-IP conditions are retained. See [规则来源与迁移记录](RULE_SOURCES.md#sukka-补充分类) for source paths, routing guidance, and compatibility.

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

Plugin conversion downloads and validates fresh inputs before serving them on loopback to Script-Hub. The CI container uses host networking and supports Loon v2; setup and local Linux instructions are in [MIGRATION.md](./MIGRATION.md#52-插件转换). The default CLI requires every conversion to be ready. CI explicitly verifies all enabled merge inputs against fresh ready results and dry-run merging; optional failures remain visible in its conversion report.

Module merging uses `Build/lib/module-merger/configs/pro-merge-config.yaml`. Every selected input must load and contain usable sections; missing inputs, undefined parameters, and unknown selection keys fail the command before publication. `--dry-run` performs the same validation without writing files. Outputs are staged in both destination directories, replaced by rename, and restored if a later replacement fails.

Imported parameters retain their defaults and descriptions under per-source names. Script names are unique across sources and within each source; Panel references follow the renamed scripts. For the generated module script switches, leave the value **empty to enable** or enter **`#` to disable**. Use an empty value instead of `1` so a source module's own script switches can still disable individual scripts.

The default configuration enables 47 of 48 entries. Tencent Video is explicitly disabled because its upstream is unmaintained and its required `CommonScript/replace-body.js` returns HTTP 404 (checked 2026-09-07). Restore its dependency and converted artifact before re-enabling it. DiDi retains its existing switch name and uses the current `滴滴去广告.sgmodule` filename.

## License

[GNU Affero General Public License v3.0](./LICENSE)

This project derives part of its build and rule-output code from [SukkaW/Surge](https://github.com/SukkaW/Surge), which is licensed under AGPL-3.0. MirrRule keeps the same AGPL-3.0 license and preserves attribution here.

Upstream rule data also comes from [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) and [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat). Their repositories retain their own licenses and attribution.

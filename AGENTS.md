# Agent Instructions

## Commands
- **Build**: `pnpm build` (full build with rules + web), `pnpm build-web` (web only), `pnpm build-profile` (with profiling)
- **Validation**: `pnpm validate` (lint + typecheck - run before commits), `pnpm lint:fix`, `pnpm typecheck`, `pnpm format`
- **Tests**: No test framework configured. Build scripts in `Build/*.ts` can be run individually with `pnpm run node Build/<script>.ts`
- **Tools**: `pnpm download-geoip`, `pnpm sync-mirrors`, `pnpm convert-plugins`, `pnpm merge-modules`

## Architecture
- **Type**: Network proxy ruleset generation system (Surge/Clash/sing-box/Loon/Surfboard)
- **Entry**: `Build/index.ts` → `Build/lib/rule-source-processor.ts` (unified rule pipeline)
- **Config**: `Build/lib/rule-sources.ts` (ruleGroups + specialRules), `Build/lib/platform-config.ts`
- **Output**: `public/` directory with multi-platform formats (List/Clash/sing-box/Loon/Surfboard)
- **Cache**: `.cache/` directory (better-sqlite3 HTTP cache + GeoIP MMDB)
- **Parsers**: `Build/core/parsers/` (platform-specific rule parsers)

## Code Style
- **Module**: CommonJS (Node.js), TypeScript strict mode
- **Package Manager**: pnpm 10.15.0 (locked, must use `pnpm` not `npm`)
- **Compiler**: @swc-node/register (no tsc compilation, JIT via SWC)
- **Linter**: eslint-config-sukka, run `pnpm validate` before commits
- **Imports**: Use `.ts` extensions in imports (allowImportingTsExtensions: true)
- **Conventions**: No console in non-CLI code, strict null checks, forceConsistentCasingInFileNames

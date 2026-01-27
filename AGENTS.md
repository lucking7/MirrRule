# Repository Guidelines

## Project Structure & Module Organization
- `Build/` holds the TypeScript rule-generation pipeline. Entry point: `Build/index.ts`.
- `Build/lib/` contains rule sources, platform config, and the unified pipeline.
- `Build/core/parsers/` contains platform-specific rule parsers.
- `scripts/` contains script-hub helpers.
- `public/` is generated output for multiple platforms. Do not edit by hand.
- `.cache/` stores HTTP cache and GeoIP data; keep it untracked.

## Build, Test, and Development Commands
- `pnpm build`: generate full rule outputs (main build).
- `pnpm build-web`: build web/public outputs only.
- `pnpm build-profile`: run build with profiling.
- `pnpm validate`: lint plus typecheck (run before commits).
- `pnpm lint:fix`, `pnpm typecheck`, `pnpm format`: local hygiene commands.
- `pnpm validate:rules`: validate rule outputs.
- `pnpm download-geoip`, `pnpm sync-mirrors`: update external data sources.
- Ad-hoc scripts: `pnpm run node Build/<script>.ts` (for example `Build/merge-modules.ts`).

## Coding Style & Naming Conventions
- TypeScript, CommonJS; strict type checking.
- Import paths include the `.ts` extension.
- Follow ESLint (eslint-config-sukka) and Prettier defaults; run `pnpm format`.
- Avoid `console` in non-CLI code.
- Use kebab-case for file names, camelCase for variables, PascalCase for types.

## Testing Guidelines
- No dedicated test framework is configured.
- Treat `pnpm validate` and `pnpm validate:rules` as the required checks.
- If you add tests, document the runner and commands in the PR.

## Commit & Pull Request Guidelines
- Git history is not available in this checkout. Use concise, imperative messages with a scope (for example `build: refresh rule sources`).
- PRs should include a short summary, commands run, and whether `public/` outputs were regenerated.
- Link related issues and note any external data source changes.

## Security & Configuration Notes
- Use `pnpm@10.15.0` as locked in `package.json`.
- Do not commit `.cache/` or downloaded GeoIP artifacts.
- This repo is AGPL-3.0; preserve attribution when importing rules.

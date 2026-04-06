# RULE-AGGREGATOR

> A comprehensive aggregation repository for network proxy modules and rules.

## Requirements

- **Node.js** 24.x (see `.node-version`)
- **pnpm** 10.x

## Quick Start

```bash
pnpm install
pnpm run build
```

`pnpm install` will fail fast on unsupported Node.js versions instead of letting native dependencies fail later during compilation.

## Available Commands

| Command | Description |
|---|---|
| `pnpm run build` | Build all rulesets |
| `pnpm run validate` | Run ESLint + TypeScript type check |
| `pnpm run validate:rules` | Validate generated rule files |
| `pnpm run security:audit` | Audit production dependencies |
| `pnpm run sync-mirrors` | Sync mirror repositories |
| `pnpm run convert-plugins` | Convert plugins |
| `pnpm run merge-modules` | Merge modules |

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](./LICENSE) file for details.

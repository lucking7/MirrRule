# Modules tree expand polish

## Surface
NRRule public index (`Build/build-public.ts` → `public/index.html`)

## Contract (from Audit/Critique)
- Nested folders must not read as bare leaf labels.
- Level-1 under a root (Modules → Converted/Merged/Rules) is a **section index**, not a deep path.
- Selecting a platform chip opens that root as the workbench.

## Changes executed
1. `folder-summary` depth classes: `is-root` | `is-section` | `is-branch`
2. Trail only for depth ≥ 2 (deep Mirror/sgmodule paths)
3. Level-1 section rows: stronger weight, count chip, hover
4. Platform chip selection auto-opens that root and closes others
5. Copy-first / sticky / collapse already in prior polish commit

## Acceptance
- Live Modules chip → only Modules open → Converted / Merged / Rules as clear section rows with counts
- No redundant "Modules / Converted" trail on L1
- Mirror deep paths still show trail at depth ≥ 2

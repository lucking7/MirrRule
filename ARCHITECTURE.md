# MirrRule Architecture

MirrRule is a rule aggregation pipeline. It downloads upstream rule artifacts, normalizes each line into a shared in-memory rule model, then writes platform-specific outputs for Surge, Clash, Loon, and sing-box.

## Build pipeline

```text
Build/index.ts
  ├─ downloadGEOIP()
  ├─ RuleSourceProcessor
  │   ├─ fetchAssets() / loadRules()
  │   └─ EnhancedFileOutput
  │       ├─ FileOutput
  │       └─ createStrategiesForTargets()
  │           ├─ SurgeRuleSet
  │           ├─ ClashClassicRuleSet
  │           ├─ LoonRuleSet
  │           └─ SingboxSource
  └─ buildPublic()
```

## Current scope

The current codebase no longer parses raw adblock filter syntax into rules. It consumes upstream rule files and forwards normalized rule-set output by target platform.

Historical adblock parsing code and unused output variants have been removed to keep the build path small and easier to audit.

## Attribution

The project derives part of its build and rule-output code from [SukkaW/Surge](https://github.com/SukkaW/Surge). SukkaW/Surge is licensed under AGPL-3.0; MirrRule is also distributed under AGPL-3.0.

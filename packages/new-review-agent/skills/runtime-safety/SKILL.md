---
name: runtime-safety
description: Catch concrete runtime crash or invalid-state regressions in changed logic.
tags:
  - typescript
  - javascript
  - api
  - security
file_patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
symbol_patterns:
  - "parseInt"
  - "Number"
  - "JSON.parse"
  - "Math"
  - "throw"
  - "catch"
---

Runtime Safety and Failure Modes Skill
Find production-facing runtime failures introduced by code changes.

Focus:

- Division-by-zero, undefined dereference, and unchecked indexing from changed flows.
- New parse/convert assumptions that can throw or produce invalid numbers.
- Error handling regressions where failure is swallowed or misrouted.
- Cross-file propagation of invalid values.

Workflow:

1. Inspect changed expressions that affect runtime safety.
2. Trace immediate data sources and guard conditions.
3. Report reproducible or likely breakage with a short trigger scenario.

Output quality:

- Prioritize concrete crash/data-corruption outcomes.
- Avoid style-level reliability suggestions.
- Include medium-confidence findings when failure mode is plausible with realistic inputs.

---
name: cross-file-impact
description: Detect behavioral regressions caused by changed code interacting with unchanged callers/callees.
tags:
  - typescript
  - javascript
  - api
file_patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
symbol_patterns:
  - "return"
  - "throw"
  - "undefined"
  - "null"
  - "await"
  - "Promise"
---

Cross-File Impact Analysis Skill
Track how changed logic propagates risk into unchanged code paths.

Example Pattern

```ts
// changed file
export function denom(value: number) {
  return 0; // contract changed
}

// unchanged caller
const ratio = 5 / denom(input); // Infinity/NaN behavior regression
```

Focus:

- Changed return values or contracts that break unchanged callers.
- Added error paths or nullability changes not handled at call sites.
- Risky arithmetic/dataflow assumptions crossing file boundaries.

Workflow:

1. Identify changed symbols and their imports/usage across repository.
2. Trace at least one unchanged caller/callee before raising a finding.
3. Report concrete runtime breakage scenario with precise quote evidence.

Output quality:

- Findings must include quote from changed line and quote from impacted usage.
- Reject speculative "could break" statements without a concrete call path.
- Include medium-confidence findings when call path is real but runtime trigger is input-dependent.

---
name: async-concurrency
description: Detect async/await, race, and state-consistency regressions.
tags:
  - typescript
  - javascript
file_patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
symbol_patterns:
  - "await"
  - "Promise"
  - "race"
  - "mutex"
  - "lock"
---

Focus:

- Missing await / fire-and-forget bugs.
- Ordering assumptions and race windows.
- Error propagation changes in async flows.

Workflow:

1. Inspect async control-flow deltas.
2. Trace dependent callers and sequencing assumptions.
3. Report high-confidence behavioral regressions.

Output quality:

- Favor concrete interleavings over hypothetical races.
- Provide simple remediation suggestions.

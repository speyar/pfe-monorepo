---
name: api-contract
description: Validate API and schema compatibility changes.
tags:
  - api
  - schema
  - typescript
file_patterns:
  - "**/*api*.ts"
  - "**/*route*.ts"
  - "**/*.prisma"
symbol_patterns:
  - "Controller"
  - "handler"
  - "schema"
  - "validate"
---

Focus:

- Breaking API request/response contract changes.
- Silent type or runtime shape mismatch.
- Handler changes not reflected in consumers.

Workflow:

1. Verify changed routes, handlers, DTOs, and schema files.
2. Trace callers and dependent modules.
3. Report only concrete regressions with evidence.

Output quality:

- Prefer fewer, high-confidence findings.
- Include actionable fix guidance.

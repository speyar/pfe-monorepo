---
name: api-contract
description: Validate API and schema compatibility with concrete consumer impact.
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

API Contract Integrity Skill
Detect silent contract breaks between handlers, schemas, and consumers.

Quick Start

- Validate request/response shape changes.
- Trace unchanged consumers of changed handlers.
- Flag runtime-incompatible contract shifts.

Focus:

- Breaking API request/response contract changes.
- Silent type or runtime shape mismatch.
- Handler changes not reflected in consumers.
- Cross-file API usage regressions.

Workflow:

1. Verify changed routes, handlers, DTOs, and schema files.
2. Trace callers and dependent modules.
3. Report concrete regressions with evidence from changed and impacted files.

Output quality:

- Prefer fewer, high-confidence findings.
- Include actionable fix guidance.
- Include medium-confidence findings when API contract drift is likely and reproducible.

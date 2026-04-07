---
name: db-migration
description: Validate migration and persistence-layer safety.
tags:
  - database
  - migration
  - schema
file_patterns:
  - "**/migrations/**"
  - "**/*.sql"
  - "**/*.prisma"
symbol_patterns:
  - "migration"
  - "transaction"
  - "index"
  - "foreign"
---

Focus:

- Destructive migration patterns.
- Backward compatibility and rollout safety.
- Query/schema drift against application expectations.

Workflow:

1. Review DDL/schema changes.
2. Trace impacted reads/writes in app code.
3. Report concrete failure scenarios.

Output quality:

- Prioritize data-loss and downtime risks.
- Keep findings concise and verifiable.

---
name: db-migration
description: Validate migration and persistence-layer safety, including app query compatibility.
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

Database Migration Safety Skill
Catch rollout-breaking persistence changes before merge.

Focus:

- Destructive migration patterns.
- Backward compatibility and rollout safety.
- Query/schema drift against application expectations.
- Cross-file read/write assumptions broken by schema changes.

Workflow:

1. Review DDL/schema changes.
2. Trace impacted reads/writes in app code.
3. Report concrete failure scenarios with impacted query path.

Output quality:

- Prioritize data-loss and downtime risks.
- Keep findings concise and verifiable.
- Include medium-confidence warnings when backward compatibility seems likely broken.

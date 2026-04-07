---
name: auth-security
description: Review authentication, authorization, and security-sensitive logic.
tags:
  - auth
  - security
file_patterns:
  - "**/*auth*.ts"
  - "**/*security*.ts"
  - "**/*middleware*.ts"
symbol_patterns:
  - "token"
  - "permission"
  - "authorize"
  - "authenticate"
---

Focus:

- Missing or weakened authorization checks.
- Token/session validation regressions.
- Security-sensitive behavior changes.

Workflow:

1. Inspect changed security/auth paths.
2. Check callers and guard usage.
3. Flag only clear risks with concrete evidence.

Output quality:

- Use high severity only when exploitability is clear.
- Avoid vague best-practice comments.

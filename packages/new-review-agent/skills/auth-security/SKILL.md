---
name: auth-security
description: Review authentication, authorization, and security-sensitive logic with caller-impact analysis.
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

Auth and Security Review Skill
Identify security regressions with practical exploitability context.

Focus:

- Missing or weakened authorization checks.
- Token/session validation regressions.
- Security-sensitive behavior changes.
- Cross-module trust-boundary regressions.

Workflow:

1. Inspect changed security/auth paths.
2. Check callers and guard usage.
3. Flag clear risks with concrete evidence; include likely-medium risks when exploit path is plausible.

Output quality:

- Use high severity only when exploitability is clear.
- Avoid vague best-practice comments.
- Include affected call path when guard assumptions change across files.

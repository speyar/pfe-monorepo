---
name: review-agent-quality
description: Review the review-agent pipeline itself for correctness and signal quality regressions.
tags:
  - typescript
  - api
file_patterns:
  - "**/new-review-agent/src/**/*.ts"
  - "**/*review-agent*.ts"
  - "**/*skill*.ts"
  - "**/*evidence*.ts"
symbol_patterns:
  - "runReviewAgentV2"
  - "harvestEvidence"
  - "verifyAndDedupeFindings"
  - "routeSkills"
  - "generateObject"
---

Review Agent Quality Skill
Diagnose why the reviewer under-reports, over-reports, or emits low-quality findings.

Focus:

- Evidence collection gaps that lead to false negatives.
- Filtering/deduping that removes valid findings.
- Non-deterministic ordering that changes comments run-to-run.
- Evidence routing defects that hide cross-file impact.

Workflow:

1. Inspect changed pipeline stages and data handoff.
2. Validate evidence volume and finding pass-through logic.
3. Report concrete regressions with file/line-level evidence and likely impact on finding quality.

Output quality:

- Prefer issues that explain zero-findings on high-churn PRs.
- Avoid suggestions not grounded in changed code paths.
- Include medium-confidence quality degradations when metrics clearly indicate signal loss.

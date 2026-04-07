---
name: webhook-lifecycle
description: Validate webhook-driven status and comment lifecycle ordering.
tags:
  - api
  - typescript
  - auth
  - security
file_patterns:
  - "**/*webhook*.ts"
  - "**/*pull-request*.ts"
  - "**/*check*.ts"
  - "**/*review*.ts"
symbol_patterns:
  - "createCheckRun"
  - "updateCheckRun"
  - "upsertPullRequestComment"
  - "createPullRequestReviewComment"
  - "deliveryId"
  - "await"
---

Webhook Lifecycle Consistency Skill
Ensure webhook processing produces ordered, durable, and race-safe external state.

Focus:

- Missing await on externally visible state transitions.
- Out-of-order check run status updates and comment writes.
- Late delivery overwriting newer state without guards.
- Error-path state transitions that leave stale in-progress markers.

Workflow:

1. Trace webhook handler branch by branch, including try/catch paths.
2. Verify each GitHub mutation is awaited and order-preserving.
3. Flag concrete race windows tied to changed code; include likely-medium race risks with realistic interleavings.

Output quality:

- Quote exact changed lines where ordering can break.
- Avoid generic async warnings without code evidence.
- Include delivery/job identity recommendations when multiple events can overlap.

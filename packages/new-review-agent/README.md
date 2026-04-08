# @pfe-monorepo/new-review-agent

PR review package with two engines:

- `v1` current reviewer (kept unchanged for baseline benchmarking)
- `v2` new architecture with dependency map + OpenCode-style skills

## Exports

- `runPullRequestReview` / `runReviewAgent` (v1)
- `runPullRequestReviewV2` / `runReviewAgentV2` (v2)

## V2 architecture

The v2 reviewer is implemented in separate files under `src/v2/` and uses:

1. Branch + diff context preparation
2. `dependencyMap` construction from changed files
3. Skill loading from `skills/**/SKILL.md`
4. Skill routing based on dependency tags/files/symbols
5. Parallel evidence harvesting for routed skills
6. Parallel skill workers for finding generation
7. Finding verification + dedupe

### Skills format (OpenCode style)

Each skill is a `SKILL.md` with frontmatter:

```md
---
name: api-contract
description: Validate API and schema compatibility changes.
tags:
  - api
file_patterns:
  - "**/*api*.ts"
symbol_patterns:
  - "schema"
---

Skill instructions here.
```

## Usage

```ts
import { runPullRequestReviewV2 } from "@pfe-monorepo/new-review-agent";

const result = await runPullRequestReviewV2({
  installationId: 123,
  owner: "acme",
  repo: "service",
  headRef: "feature/new-change",
  baseRef: "main",
});
```

### V2 options

- `modelName`
- `maxFindings`
- `maxSkillWorkers`
- `maxSymbols`
- `skillsDir` (override default `packages/new-review-agent/skills`)

## Benchmarking v1 vs v2

Run both engines on the same PR payload and compare:

- finding quality and duplication
- inline-comment postability
- runtime latency
- number of findings by severity
- stability across reruns

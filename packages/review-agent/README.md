# @pfe-monorepo/review-agent

Code-review-only agent package powered by Vercel AI SDK (GitHub Copilot provider).

## Scope

- Accept pull-request review input (repo + PR metadata + changed files).
- Generate structured review findings with an LLM.
- Return validated JSON output for downstream orchestration layers.

This package intentionally does not include webhook handling, background jobs, persistence, or GitHub comment publishing.

## Usage

```ts
import {
  createGitHubReviewModel,
  createReviewAgent,
  type ReviewRequest,
} from "@pfe-monorepo/review-agent";

const model = createGitHubReviewModel({
  githubToken: process.env.COPILOT_GITHUB_TOKEN,
});

const agent = createReviewAgent({ model });

const request: ReviewRequest = {
  repository: { owner: "acme", name: "service" },
  pullRequest: {
    number: 42,
    title: "Improve auth middleware",
    baseSha: "base-sha",
    headSha: "head-sha",
  },
  files: [
    {
      path: "src/auth.ts",
      patch: "@@ -10,7 +10,8 @@\n-  return true;\n+  return token !== null;",
    },
  ],
};

const result = await agent.reviewPullRequest(request);
```

## Quick Local Run

Run with JSON input:

```powershell
Set-Location packages/review-agent
$env:COPILOT_GITHUB_TOKEN="your_github_token"
bun run review --input ./examples/review-input.json
```

Run ad-hoc review from a file:

```powershell
Set-Location packages/review-agent
$env:COPILOT_GITHUB_TOKEN="your_github_token"
bun run review --file ./src/core/run-review.ts
```

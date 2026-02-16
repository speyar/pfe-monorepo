# @pfe-monorepo/github-api

Typed low-level GitHub primitives for agent packages.

## Scope

This package is intentionally GitHub-specific and keeps APIs low-level so higher-level agent packages can compose their own workflows.

## Authentication

Primary auth mode is GitHub App installation auth.

```ts
import { createGitHubAppClient } from "@pfe-monorepo/github-api";

const client = await createGitHubAppClient({
  appId: Number(process.env.GITHUB_APP_ID),
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  installationId: Number(process.env.GITHUB_APP_INSTALLATION_ID),
});
```

## Primitives

### Repository and pull requests

- `getRepository`
- `getPullRequest`
- `listPullRequestFiles`
- `getPullRequestDiff`

### Comments

- `createPullRequestComment`
- `createPullRequestReviewComment`
- `updateComment`
- `deleteComment`
- `upsertPullRequestComment`

### Webhooks

- `registerRepositoryWebhook`
  - Typed repository webhook registration
  - Upsert behavior by callback URL (create when missing, update when existing)
  - PR-focused event union: `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`

### Git clone

- `cloneRepository`
  - Clones into an empty destination path
  - Optional checkout ref
  - Optional token-authenticated HTTPS URL

## Error handling

All exported helpers normalize failures to `GitHubApiError` with:

- `code`: authentication/forbidden/not_found/validation/rate_limited/unknown
- optional `status`
- original `cause`

## Notes for agent packages

- Keep business logic and orchestration outside this package.
- Use this package for typed I/O with GitHub only.
- Use webhook setup + PR diff + comment helpers as building blocks for review bots.

export { createGitHubAppClient } from "./client";
export { GitHubApiError, normalizeGitHubError } from "./errors";
export { getPullRequest, getPullRequestDiff, listPullRequestFiles } from "./pull-requests";
export { getRepository } from "./repositories";
export { registerRepositoryWebhook } from "./webhooks/register-repository-webhook";

export type {
	CreateGitHubAppClientInput,
	GitHubAppAuthInput,
	GitHubClient,
	GitHubOwnerRepo,
	PullRequestDiff,
	PullRequestFile,
	PullRequestSummary,
	RepositorySummary,
} from "./types";

export type {
	PullRequestWebhookEvent,
	RegisterRepositoryWebhookInput,
	RegisterRepositoryWebhookResult,
} from "./webhooks/register-repository-webhook";

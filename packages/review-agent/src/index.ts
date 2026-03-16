export { createReviewAgent, runReview } from "./core/run-review";
export { normalizeReviewRequest } from "./core/normalize-input";
export { validateReviewResult } from "./core/validate-output";

export {
  type FileChangeStatus,
  type ReviewPullRequest,
  type ReviewRepository,
  type ReviewRequest,
  type ReviewRequestConfig,
  type ReviewRequestFile,
} from "./contracts/review-request";

export {
  REVIEW_SEVERITIES,
  REVIEW_VERDICTS,
  type ReviewFinding,
  type ReviewResult,
  type ReviewSeverity,
  type ReviewSummary,
  type ReviewVerdict,
} from "./contracts/review-result";

export {
  InputValidationError,
  OutputValidationError,
  ProviderConfigError,
  ReviewAgentError,
} from "./errors/review-errors";

export {
  createGitHubReviewModel,
  type CreateGitHubReviewModelInput,
} from "./llm/provider";
export { buildReviewPrompt, DEFAULT_REVIEW_SYSTEM_PROMPT } from "./llm/prompts";

export {
  reviewFindingSchema,
  reviewResultSchema,
  reviewSummarySchema,
  type ReviewResultSchema,
} from "./schema/review-result.schema";

export {
  listFiles,
  readFile,
  searchRepository,
  RepoToolError,
  type ListFilesFailure,
  type ListFilesOptions,
  type ListFilesResult,
  type ListFilesSuccess,
  type ReadFileFailure,
  type ReadFileOptions,
  type ReadFileResult,
  type ReadFileSuccess,
  type RepoToolErrorCode,
  type RepoToolErrorData,
  type SearchRepositoryFailure,
  type SearchRepositoryMatch,
  type SearchRepositoryOptions,
  type SearchRepositoryResult,
  type SearchRepositorySuccess,
} from "./lib/repo-tools";

export {
  createPrReviewAgent,
  runPrReviewWithRepositoryTools,
  DEFAULT_REPOSITORY_EXPLORATION_SYSTEM_PROMPT,
  type CreatePrReviewAgentOptions,
  type PrReviewAgent,
} from "./lib/agent/pr-review-agent";

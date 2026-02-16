export type GitHubApiErrorCode =
  | "UNKNOWN"
  | "AUTHENTICATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED";

export class GitHubApiError extends Error {
  readonly code: GitHubApiErrorCode;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(args: {
    message: string;
    code?: GitHubApiErrorCode;
    status?: number;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "GitHubApiError";
    this.code = args.code ?? "UNKNOWN";
    this.status = args.status;
    this.cause = args.cause;
  }
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown GitHub API error";
};

export const normalizeGitHubError = (
  error: unknown,
  fallbackMessage: string
): GitHubApiError => {
  if (error instanceof GitHubApiError) {
    return error;
  }

  const maybeStatus =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined;

  const status = typeof maybeStatus === "number" ? maybeStatus : undefined;

  if (status === 401) {
    return new GitHubApiError({
      message: fallbackMessage,
      code: "AUTHENTICATION",
      status,
      cause: error,
    });
  }

  if (status === 403) {
    return new GitHubApiError({
      message: fallbackMessage,
      code: "FORBIDDEN",
      status,
      cause: error,
    });
  }

  if (status === 404) {
    return new GitHubApiError({
      message: fallbackMessage,
      code: "NOT_FOUND",
      status,
      cause: error,
    });
  }

  if (status === 422) {
    return new GitHubApiError({
      message: fallbackMessage,
      code: "VALIDATION",
      status,
      cause: error,
    });
  }

  if (status === 429) {
    return new GitHubApiError({
      message: fallbackMessage,
      code: "RATE_LIMITED",
      status,
      cause: error,
    });
  }

  return new GitHubApiError({
    message: `${fallbackMessage}: ${getErrorMessage(error)}`,
    code: "UNKNOWN",
    status,
    cause: error,
  });
};

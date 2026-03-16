import { isAbsolute, relative, resolve } from "node:path";

export type RepoToolErrorCode =
  | "INVALID_PATH"
  | "PATH_OUTSIDE_REPOSITORY"
  | "FILE_NOT_FOUND"
  | "DIRECTORY_NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "INVALID_QUERY"
  | "INVALID_OPTIONS"
  | "RIPGREP_NOT_FOUND"
  | "SEARCH_FAILED"
  | "SEARCH_TIMEOUT"
  | "READ_FAILED"
  | "LIST_FAILED"
  | "UNKNOWN_ERROR";

export interface RepoToolErrorData {
  code: RepoToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class RepoToolError extends Error {
  public readonly code: RepoToolErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: RepoToolErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RepoToolError";
    this.code = code;
    this.details = details;
  }

  toJSON(): RepoToolErrorData {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export interface ResolvedRepositoryPath {
  repositoryRoot: string;
  absolutePath: string;
  relativePath: string;
}

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function normalizeRepositoryRoot(repositoryRoot?: string): string {
  return resolve(repositoryRoot ?? process.cwd());
}

export function ensurePathInsideRepository(
  repositoryRoot: string,
  targetPath: string,
): ResolvedRepositoryPath {
  const trimmedPath = targetPath.trim();
  if (!trimmedPath) {
    throw new RepoToolError("INVALID_PATH", "Path cannot be empty.");
  }

  const normalizedRoot = normalizeRepositoryRoot(repositoryRoot);
  const absolutePath = resolve(normalizedRoot, trimmedPath);
  const relativePath = relative(normalizedRoot, absolutePath);

  if (
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    if (relativePath === "") {
      return {
        repositoryRoot: normalizedRoot,
        absolutePath,
        relativePath: ".",
      };
    }

    throw new RepoToolError(
      "PATH_OUTSIDE_REPOSITORY",
      "Path must be inside the repository root.",
      {
        targetPath: trimmedPath,
        repositoryRoot: normalizedRoot,
      },
    );
  }

  return {
    repositoryRoot: normalizedRoot,
    absolutePath,
    relativePath: toPosixPath(relativePath),
  };
}

export function toRepoToolErrorData(
  error: unknown,
  fallbackCode: RepoToolErrorCode,
): RepoToolErrorData {
  if (error instanceof RepoToolError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
    };
  }

  return {
    code: fallbackCode,
    message: "Unknown repository tool error.",
    details: {
      error,
    },
  };
}

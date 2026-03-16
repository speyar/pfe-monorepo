import { spawn } from "node:child_process";

import {
  RepoToolError,
  type RepoToolErrorData,
  normalizeRepositoryRoot,
  toPosixPath,
  toRepoToolErrorData,
} from "./shared";

const DEFAULT_MAX_RESULTS = 100;
const MAX_MAX_RESULTS = 500;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PREVIEW_CHARS = 240;

export interface SearchRepositoryOptions {
  repositoryRoot?: string;
  isRegexp?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  timeoutMs?: number;
  includeGlobs?: string[];
}

export interface SearchRepositoryMatch {
  file: string;
  line: number;
  text: string;
}

export interface SearchRepositorySuccess {
  ok: true;
  query: string;
  repositoryRoot: string;
  maxResults: number;
  truncated: boolean;
  matches: SearchRepositoryMatch[];
}

export interface SearchRepositoryFailure {
  ok: false;
  query: string;
  repositoryRoot: string;
  error: RepoToolErrorData;
}

export type SearchRepositoryResult =
  | SearchRepositorySuccess
  | SearchRepositoryFailure;

function resolveMaxResults(maxResults?: number): number {
  if (maxResults === undefined) {
    return DEFAULT_MAX_RESULTS;
  }

  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_MAX_RESULTS
  ) {
    throw new RepoToolError(
      "INVALID_OPTIONS",
      `maxResults must be an integer between 1 and ${MAX_MAX_RESULTS}.`,
      {
        maxResults,
      },
    );
  }

  return maxResults;
}

function resolveTimeout(timeoutMs?: number): number {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RepoToolError(
      "INVALID_OPTIONS",
      `timeoutMs must be an integer between 100 and ${MAX_TIMEOUT_MS}.`,
      {
        timeoutMs,
      },
    );
  }

  return timeoutMs;
}

function normalizePreview(value: string): string {
  const oneLine = value.replace(/\r?\n$/, "").trim();
  if (oneLine.length <= MAX_PREVIEW_CHARS) {
    return oneLine;
  }

  return `${oneLine.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function parseRipgrepLine(line: string): SearchRepositoryMatch | null {
  if (!line.trim()) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const event = parsed as {
    type?: string;
    data?: {
      path?: { text?: string };
      line_number?: number;
      lines?: { text?: string };
    };
  };

  if (event.type !== "match") {
    return null;
  }

  const file = event.data?.path?.text;
  const lineNumber = event.data?.line_number;
  const text = event.data?.lines?.text;

  if (!file || typeof lineNumber !== "number" || typeof text !== "string") {
    return null;
  }

  return {
    file: toPosixPath(file),
    line: lineNumber,
    text: normalizePreview(text),
  };
}

function buildRipgrepArgs(
  query: string,
  options: {
    isRegexp: boolean;
    caseSensitive: boolean;
    includeGlobs: string[];
  },
): string[] {
  const args = [
    "--json",
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--max-columns",
    "300",
    "--max-columns-preview",
  ];

  if (!options.isRegexp) {
    args.push("--fixed-strings");
  }

  if (options.caseSensitive) {
    args.push("--case-sensitive");
  } else {
    args.push("--smart-case");
  }

  for (const glob of options.includeGlobs) {
    const trimmedGlob = glob.trim();
    if (!trimmedGlob) {
      continue;
    }

    args.push("-g", trimmedGlob);
  }

  args.push(query, ".");

  return args;
}

export async function searchRepository(
  query: string,
  options: SearchRepositoryOptions = {},
): Promise<SearchRepositoryResult> {
  const repositoryRoot = normalizeRepositoryRoot(options.repositoryRoot);
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return {
      ok: false,
      query,
      repositoryRoot,
      error: new RepoToolError(
        "INVALID_QUERY",
        "Query must be a non-empty string.",
      ).toJSON(),
    };
  }

  let maxResults: number;
  let timeoutMs: number;

  try {
    maxResults = resolveMaxResults(options.maxResults);
    timeoutMs = resolveTimeout(options.timeoutMs);
  } catch (error) {
    return {
      ok: false,
      query: trimmedQuery,
      repositoryRoot,
      error: toRepoToolErrorData(error, "INVALID_OPTIONS"),
    };
  }

  const args = buildRipgrepArgs(trimmedQuery, {
    isRegexp: options.isRegexp ?? false,
    caseSensitive: options.caseSensitive ?? false,
    includeGlobs: options.includeGlobs ?? [],
  });

  return new Promise<SearchRepositoryResult>((resolveResult) => {
    const matches: SearchRepositoryMatch[] = [];
    let buffer = "";
    let stderr = "";
    let isDone = false;
    let isTruncated = false;
    let isTimedOut = false;

    const child = spawn("rg", args, {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const done = (result: SearchRepositoryResult): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      clearTimeout(timeout);
      resolveResult(result);
    };

    const collectLine = (line: string): void => {
      const match = parseRipgrepLine(line);
      if (!match) {
        return;
      }

      matches.push(match);

      if (matches.length >= maxResults) {
        isTruncated = true;
        child.kill();
      }
    };

    const flushBuffer = (): void => {
      if (!buffer.trim()) {
        return;
      }

      collectLine(buffer);
      buffer = "";
    };

    const timeout = setTimeout(() => {
      isTimedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        collectLine(line);

        newlineIndex = buffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      const ioError = error as NodeJS.ErrnoException;

      if (ioError.code === "ENOENT") {
        done({
          ok: false,
          query: trimmedQuery,
          repositoryRoot,
          error: new RepoToolError(
            "RIPGREP_NOT_FOUND",
            "Ripgrep (rg) is not available in PATH.",
          ).toJSON(),
        });

        return;
      }

      done({
        ok: false,
        query: trimmedQuery,
        repositoryRoot,
        error: toRepoToolErrorData(error, "SEARCH_FAILED"),
      });
    });

    child.on("close", (code, signal) => {
      flushBuffer();

      if (isTimedOut) {
        done({
          ok: false,
          query: trimmedQuery,
          repositoryRoot,
          error: new RepoToolError(
            "SEARCH_TIMEOUT",
            `Search timed out after ${timeoutMs}ms.`,
            {
              timeoutMs,
            },
          ).toJSON(),
        });

        return;
      }

      if (isTruncated) {
        done({
          ok: true,
          query: trimmedQuery,
          repositoryRoot,
          maxResults,
          truncated: true,
          matches,
        });

        return;
      }

      if (code === 0 || code === 1) {
        done({
          ok: true,
          query: trimmedQuery,
          repositoryRoot,
          maxResults,
          truncated: false,
          matches,
        });

        return;
      }

      done({
        ok: false,
        query: trimmedQuery,
        repositoryRoot,
        error: new RepoToolError("SEARCH_FAILED", "Ripgrep search failed.", {
          exitCode: code,
          signal,
          stderr: stderr.trim() || undefined,
        }).toJSON(),
      });
    });
  });
}

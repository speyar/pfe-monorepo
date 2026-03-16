import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  RepoToolError,
  type RepoToolErrorData,
  ensurePathInsideRepository,
  normalizeRepositoryRoot,
  toPosixPath,
  toRepoToolErrorData,
} from "./shared";

const DEFAULT_MAX_DEPTH = 2;
const MAX_MAX_DEPTH = 8;
const DEFAULT_MAX_ENTRIES = 400;
const MAX_MAX_ENTRIES = 2_000;

export interface ListFilesOptions {
  repositoryRoot?: string;
  maxDepth?: number;
  maxEntries?: number;
}

export interface ListFilesSuccess {
  ok: true;
  path: string;
  repositoryRoot: string;
  maxDepth: number;
  maxEntries: number;
  truncated: boolean;
  entries: string[];
}

export interface ListFilesFailure {
  ok: false;
  path: string;
  repositoryRoot: string;
  error: RepoToolErrorData;
}

export type ListFilesResult = ListFilesSuccess | ListFilesFailure;

function resolveMaxDepth(maxDepth?: number): number {
  if (maxDepth === undefined) {
    return DEFAULT_MAX_DEPTH;
  }

  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_MAX_DEPTH) {
    throw new RepoToolError(
      "INVALID_OPTIONS",
      `maxDepth must be an integer between 0 and ${MAX_MAX_DEPTH}.`,
      {
        maxDepth,
      },
    );
  }

  return maxDepth;
}

function resolveMaxEntries(maxEntries?: number): number {
  if (maxEntries === undefined) {
    return DEFAULT_MAX_ENTRIES;
  }

  if (
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_MAX_ENTRIES
  ) {
    throw new RepoToolError(
      "INVALID_OPTIONS",
      `maxEntries must be an integer between 1 and ${MAX_MAX_ENTRIES}.`,
      {
        maxEntries,
      },
    );
  }

  return maxEntries;
}

export async function listFiles(
  path: string,
  options: ListFilesOptions = {},
): Promise<ListFilesResult> {
  const repositoryRoot = normalizeRepositoryRoot(options.repositoryRoot);
  const requestedPath = path.trim() || ".";

  let maxDepth: number;
  let maxEntries: number;

  try {
    maxDepth = resolveMaxDepth(options.maxDepth);
    maxEntries = resolveMaxEntries(options.maxEntries);
  } catch (error) {
    return {
      ok: false,
      path: toPosixPath(requestedPath),
      repositoryRoot,
      error: toRepoToolErrorData(error, "INVALID_OPTIONS"),
    };
  }

  try {
    const resolved = ensurePathInsideRepository(repositoryRoot, requestedPath);
    const directoryStat = await stat(resolved.absolutePath);

    if (!directoryStat.isDirectory()) {
      return {
        ok: false,
        path: resolved.relativePath,
        repositoryRoot,
        error: new RepoToolError(
          "NOT_A_DIRECTORY",
          "The provided path is not a directory.",
          {
            path: resolved.relativePath,
          },
        ).toJSON(),
      };
    }

    const entries: string[] = [];
    let truncated = false;

    const visitDirectory = async (
      absoluteDirectoryPath: string,
      currentDepth: number,
    ): Promise<void> => {
      if (truncated || currentDepth > maxDepth) {
        return;
      }

      const dirEntries = await readdir(absoluteDirectoryPath, {
        withFileTypes: true,
      });

      dirEntries.sort((a, b) => a.name.localeCompare(b.name));

      for (const dirEntry of dirEntries) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }

        const absoluteEntryPath = join(absoluteDirectoryPath, dirEntry.name);
        const relativeEntryPath = toPosixPath(
          relative(repositoryRoot, absoluteEntryPath),
        );

        if (dirEntry.isDirectory()) {
          entries.push(`${relativeEntryPath}/`);

          if (currentDepth < maxDepth) {
            await visitDirectory(absoluteEntryPath, currentDepth + 1);
          }

          continue;
        }

        entries.push(relativeEntryPath);
      }
    };

    await visitDirectory(resolved.absolutePath, 0);

    return {
      ok: true,
      path: resolved.relativePath,
      repositoryRoot,
      maxDepth,
      maxEntries,
      truncated,
      entries,
    };
  } catch (error) {
    const ioError = error as NodeJS.ErrnoException;
    if (ioError.code === "ENOENT") {
      return {
        ok: false,
        path: toPosixPath(requestedPath),
        repositoryRoot,
        error: new RepoToolError(
          "DIRECTORY_NOT_FOUND",
          `Directory not found: ${requestedPath}`,
          {
            path: requestedPath,
          },
        ).toJSON(),
      };
    }

    return {
      ok: false,
      path: toPosixPath(requestedPath),
      repositoryRoot,
      error: toRepoToolErrorData(error, "LIST_FAILED"),
    };
  }
}

import { open } from "node:fs/promises";

import {
  RepoToolError,
  type RepoToolErrorData,
  ensurePathInsideRepository,
  normalizeRepositoryRoot,
  toPosixPath,
  toRepoToolErrorData,
} from "./shared";

const DEFAULT_MAX_BYTES = 64_000;
const MAX_MAX_BYTES = 500_000;

export interface ReadFileOptions {
  repositoryRoot?: string;
  maxBytes?: number;
  encoding?: BufferEncoding;
}

export interface ReadFileSuccess {
  ok: true;
  path: string;
  repositoryRoot: string;
  content: string;
  totalBytes: number;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
}

export interface ReadFileFailure {
  ok: false;
  path: string;
  repositoryRoot: string;
  error: RepoToolErrorData;
}

export type ReadFileResult = ReadFileSuccess | ReadFileFailure;

function resolveMaxBytes(maxBytes?: number): number {
  if (maxBytes === undefined) {
    return DEFAULT_MAX_BYTES;
  }

  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_MAX_BYTES) {
    throw new RepoToolError(
      "INVALID_OPTIONS",
      `maxBytes must be an integer between 1 and ${MAX_MAX_BYTES}.`,
      {
        maxBytes,
      },
    );
  }

  return maxBytes;
}

export async function readFile(
  path: string,
  options: ReadFileOptions = {},
): Promise<ReadFileResult> {
  const repositoryRoot = normalizeRepositoryRoot(options.repositoryRoot);
  const encoding = options.encoding ?? "utf8";

  let relativePath = toPosixPath(path.trim());

  try {
    const maxBytes = resolveMaxBytes(options.maxBytes);
    const resolved = ensurePathInsideRepository(repositoryRoot, path);
    relativePath = resolved.relativePath;

    const handle = await open(resolved.absolutePath, "r");

    try {
      const stat = await handle.stat();

      if (!stat.isFile()) {
        return {
          ok: false,
          path: relativePath,
          repositoryRoot,
          error: new RepoToolError(
            "NOT_A_FILE",
            "The provided path is not a file.",
            {
              path: relativePath,
            },
          ).toJSON(),
        };
      }

      const bytesToRead = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);

      return {
        ok: true,
        path: relativePath,
        repositoryRoot,
        content: buffer.subarray(0, bytesRead).toString(encoding),
        totalBytes: stat.size,
        bytesRead,
        maxBytes,
        truncated: stat.size > maxBytes,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const ioError = error as NodeJS.ErrnoException;
    if (ioError?.code === "ENOENT") {
      throw new RepoToolError("FILE_NOT_FOUND", `File not found: ${path}`, {
        path,
        repositoryRoot,
      });
    }

    if (error instanceof RepoToolError) {
      return {
        ok: false,
        path: relativePath,
        repositoryRoot,
        error: error.toJSON(),
      };
    }

    return {
      ok: false,
      path: relativePath,
      repositoryRoot,
      error: toRepoToolErrorData(error, "READ_FAILED"),
    };
  }
}

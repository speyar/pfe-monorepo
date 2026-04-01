import {
  RepoToolError,
  type ListFilesOptions,
  type ListFilesResult,
  type ReadFileOptions,
  type ReadFileResult,
  type SearchRepositoryOptions,
  type SearchRepositoryResult,
} from "../lib/repo-tools";
import type { RepoToolErrorData } from "../lib/repo-tools/shared";

import type { SandboxManager } from "@packages/sandbox";

import type { RepositoryToolsRunner } from "./types";

const DEFAULT_READ_FILE_MAX_BYTES = 64_000;
const DEFAULT_SEARCH_MAX_RESULTS = 120;
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_LIST_MAX_DEPTH = 2;
const DEFAULT_LIST_MAX_ENTRIES = 400;

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toRepoToolErrorData(
  code: RepoToolErrorData["code"],
  message: string,
  details?: Record<string, unknown>,
): RepoToolErrorData {
  return { code, message, details };
}

function toRelativePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized || normalized === ".") {
    return ".";
  }

  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new RepoToolError(
      "PATH_OUTSIDE_REPOSITORY",
      "Path must be relative and stay within repository root.",
      { path },
    );
  }

  return normalized;
}

export interface CreateSandboxRepositoryToolsRunnerOptions {
  sandboxManager: SandboxManager;
  sandboxId: string;
  repositoryRoot: string;
}

export function createSandboxRepositoryToolsRunner(
  options: CreateSandboxRepositoryToolsRunnerOptions,
): RepositoryToolsRunner {
  const runCommand = async (
    command: string,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const result = await options.sandboxManager.runCommand({
      sandboxId: options.sandboxId,
      command,
      cwd: options.repositoryRoot,
      timeoutMs,
    });

    return result;
  };

  return {
    readFile: async (
      path: string,
      readOptions: ReadFileOptions = {},
    ): Promise<ReadFileResult> => {
      let relativePath = ".";

      try {
        relativePath = toRelativePath(path);
        const maxBytes = readOptions.maxBytes ?? DEFAULT_READ_FILE_MAX_BYTES;
        const command = `node - <<'NODE'\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst root = path.resolve(${quotePosix(options.repositoryRoot)});\nconst rel = ${quotePosix(relativePath)};\nconst maxBytes = ${maxBytes};\nconst target = path.resolve(root, rel);\nif (!target.startsWith(root)) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'PATH_OUTSIDE_REPOSITORY', message: 'Path must be inside repository root.' }, path: rel }));\n  process.exit(0);\n}\nif (!fs.existsSync(target)) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'FILE_NOT_FOUND', message: 'File not found: ' + rel }, path: rel }));\n  process.exit(0);\n}\nconst stat = fs.statSync(target);\nif (!stat.isFile()) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'NOT_A_FILE', message: 'The provided path is not a file.' }, path: rel }));\n  process.exit(0);\n}\nconst handle = fs.openSync(target, 'r');\nconst toRead = Math.min(stat.size, maxBytes);\nconst buffer = Buffer.alloc(toRead);\nconst bytesRead = fs.readSync(handle, buffer, 0, toRead, 0);\nfs.closeSync(handle);\nconsole.log(JSON.stringify({ ok: true, path: rel, content: buffer.subarray(0, bytesRead).toString('utf8'), totalBytes: stat.size, bytesRead, maxBytes, truncated: stat.size > maxBytes }));\nNODE`;

        const result = await runCommand(command, 20_000);
        if (result.exitCode !== 0) {
          return {
            ok: false,
            path: relativePath,
            repositoryRoot: options.repositoryRoot,
            error: toRepoToolErrorData(
              "READ_FAILED",
              result.stderr.trim() || "Failed to read file in sandbox.",
            ),
          };
        }

        const parsed = JSON.parse(result.stdout.trim()) as
          | {
              ok: true;
              path: string;
              content: string;
              totalBytes: number;
              bytesRead: number;
              maxBytes: number;
              truncated: boolean;
            }
          | {
              ok: false;
              path: string;
              error: RepoToolErrorData;
            };

        if (!parsed.ok) {
          return {
            ok: false,
            path: parsed.path,
            repositoryRoot: options.repositoryRoot,
            error: parsed.error,
          };
        }

        return {
          ok: true,
          path: parsed.path,
          repositoryRoot: options.repositoryRoot,
          content: parsed.content,
          totalBytes: parsed.totalBytes,
          bytesRead: parsed.bytesRead,
          maxBytes: parsed.maxBytes,
          truncated: parsed.truncated,
        };
      } catch (error) {
        return {
          ok: false,
          path: relativePath,
          repositoryRoot: options.repositoryRoot,
          error: toRepoToolErrorData(
            "READ_FAILED",
            error instanceof Error ? error.message : "Unknown read error.",
          ),
        };
      }
    },

    listFiles: async (
      path: string,
      listOptions: ListFilesOptions = {},
    ): Promise<ListFilesResult> => {
      let relativePath = ".";

      try {
        relativePath = toRelativePath(path || ".");
        const maxDepth = listOptions.maxDepth ?? DEFAULT_LIST_MAX_DEPTH;
        const maxEntries = listOptions.maxEntries ?? DEFAULT_LIST_MAX_ENTRIES;

        const command = `node - <<'NODE'\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst root = path.resolve(${quotePosix(options.repositoryRoot)});\nconst rel = ${quotePosix(relativePath)};\nconst maxDepth = ${maxDepth};\nconst maxEntries = ${maxEntries};\nconst start = path.resolve(root, rel);\nif (!start.startsWith(root)) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'PATH_OUTSIDE_REPOSITORY', message: 'Path must be inside repository root.' }, path: rel }));\n  process.exit(0);\n}\nif (!fs.existsSync(start)) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'DIRECTORY_NOT_FOUND', message: 'Directory not found: ' + rel }, path: rel }));\n  process.exit(0);\n}\nif (!fs.statSync(start).isDirectory()) {\n  console.log(JSON.stringify({ ok: false, error: { code: 'NOT_A_DIRECTORY', message: 'The provided path is not a directory.' }, path: rel }));\n  process.exit(0);\n}\nconst entries = [];\nlet truncated = false;\nfunction visit(current, depth) {\n  if (truncated || depth > maxDepth) return;\n  const children = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));\n  for (const child of children) {\n    if (entries.length >= maxEntries) { truncated = true; return; }\n    const absolute = path.join(current, child.name);\n    const relative = path.relative(root, absolute).replaceAll('\\\\', '/');\n    if (child.isDirectory()) {\n      entries.push(relative + '/');\n      if (depth < maxDepth) visit(absolute, depth + 1);\n    } else {\n      entries.push(relative);\n    }\n  }\n}\nvisit(start, 0);\nconsole.log(JSON.stringify({ ok: true, path: rel, maxDepth, maxEntries, truncated, entries }));\nNODE`;

        const result = await runCommand(command, 20_000);
        if (result.exitCode !== 0) {
          return {
            ok: false,
            path: relativePath,
            repositoryRoot: options.repositoryRoot,
            error: toRepoToolErrorData(
              "LIST_FAILED",
              result.stderr.trim() || "Failed to list files in sandbox.",
            ),
          };
        }

        const parsed = JSON.parse(result.stdout.trim()) as
          | {
              ok: true;
              path: string;
              maxDepth: number;
              maxEntries: number;
              truncated: boolean;
              entries: string[];
            }
          | {
              ok: false;
              path: string;
              error: RepoToolErrorData;
            };

        if (!parsed.ok) {
          return {
            ok: false,
            path: parsed.path,
            repositoryRoot: options.repositoryRoot,
            error: parsed.error,
          };
        }

        return {
          ok: true,
          path: parsed.path,
          repositoryRoot: options.repositoryRoot,
          maxDepth: parsed.maxDepth,
          maxEntries: parsed.maxEntries,
          truncated: parsed.truncated,
          entries: parsed.entries,
        };
      } catch (error) {
        return {
          ok: false,
          path: relativePath,
          repositoryRoot: options.repositoryRoot,
          error: toRepoToolErrorData(
            "LIST_FAILED",
            error instanceof Error ? error.message : "Unknown list error.",
          ),
        };
      }
    },

    searchRepository: async (
      query: string,
      searchOptions: SearchRepositoryOptions = {},
    ): Promise<SearchRepositoryResult> => {
      try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
          return {
            ok: false,
            query,
            repositoryRoot: options.repositoryRoot,
            error: toRepoToolErrorData(
              "INVALID_QUERY",
              "Query must be a non-empty string.",
            ),
          };
        }

        const maxResults =
          searchOptions.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
        const timeoutMs = searchOptions.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
        const flags = [
          "--json",
          "--line-number",
          "--no-heading",
          "--color",
          "never",
          "--max-columns",
          "300",
          "--max-columns-preview",
        ];

        if (!(searchOptions.isRegexp ?? false)) {
          flags.push("--fixed-strings");
        }

        flags.push(
          (searchOptions.caseSensitive ?? false)
            ? "--case-sensitive"
            : "--smart-case",
        );

        for (const glob of searchOptions.includeGlobs ?? []) {
          const trimmed = glob.trim();
          if (trimmed) {
            flags.push("-g", trimmed);
          }
        }

        const args = [
          ...flags.map((item) => quotePosix(item)),
          quotePosix(trimmedQuery),
          quotePosix("."),
        ].join(" ");
        const command = `rg ${args}`;

        const result = await runCommand(command, timeoutMs);
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return {
            ok: false,
            query: trimmedQuery,
            repositoryRoot: options.repositoryRoot,
            error: toRepoToolErrorData(
              "SEARCH_FAILED",
              result.stderr.trim() || "Ripgrep search failed.",
              { exitCode: result.exitCode },
            ),
          };
        }

        const lines = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const matches: Array<{ file: string; line: number; text: string }> = [];

        for (const line of lines) {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          const typed = event as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };

          if (typed.type !== "match") {
            continue;
          }

          const file = typed.data?.path?.text;
          const lineNumber = typed.data?.line_number;
          const text = typed.data?.lines?.text;

          if (
            !file ||
            typeof lineNumber !== "number" ||
            typeof text !== "string"
          ) {
            continue;
          }

          matches.push({
            file: file.replace(/\\/g, "/"),
            line: lineNumber,
            text: text.replace(/\r?\n$/, "").trim(),
          });

          if (matches.length >= maxResults) {
            break;
          }
        }

        return {
          ok: true,
          query: trimmedQuery,
          repositoryRoot: options.repositoryRoot,
          maxResults,
          truncated: matches.length >= maxResults,
          matches,
        };
      } catch (error) {
        return {
          ok: false,
          query,
          repositoryRoot: options.repositoryRoot,
          error: toRepoToolErrorData(
            "SEARCH_FAILED",
            error instanceof Error ? error.message : "Unknown search error.",
          ),
        };
      }
    },

    runCommand: async ({ command, cwd, timeoutMs }) => {
      const result = await options.sandboxManager.runCommand({
        sandboxId: options.sandboxId,
        command,
        cwd: cwd ?? options.repositoryRoot,
        timeoutMs,
      });

      return {
        ok: true,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  };
}

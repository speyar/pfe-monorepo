import {
  listFiles,
  readFile,
  searchRepository,
  type ListFilesOptions,
  type ListFilesResult,
  type ReadFileOptions,
  type ReadFileResult,
  type SearchRepositoryOptions,
  type SearchRepositoryResult,
} from "../lib/repo-tools";

import type { RepositoryToolsRunner } from "./types";

export interface CreateLocalRepositoryToolsRunnerOptions {
  repositoryRoot?: string;
}

export function createLocalRepositoryToolsRunner(
  options: CreateLocalRepositoryToolsRunnerOptions = {},
): RepositoryToolsRunner {
  return {
    readFile: (
      path: string,
      readOptions: ReadFileOptions = {},
    ): Promise<ReadFileResult> =>
      readFile(path, {
        ...readOptions,
        repositoryRoot: options.repositoryRoot ?? readOptions.repositoryRoot,
      }),

    listFiles: (
      path: string,
      listOptions: ListFilesOptions = {},
    ): Promise<ListFilesResult> =>
      listFiles(path, {
        ...listOptions,
        repositoryRoot: options.repositoryRoot ?? listOptions.repositoryRoot,
      }),

    searchRepository: (
      query: string,
      searchOptions: SearchRepositoryOptions = {},
    ): Promise<SearchRepositoryResult> =>
      searchRepository(query, {
        ...searchOptions,
        repositoryRoot: options.repositoryRoot ?? searchOptions.repositoryRoot,
      }),

    runCommand: async ({ command, cwd, timeoutMs }) => {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 15_000;

      const { spawn } = await import("node:child_process");

      return new Promise((resolve) => {
        const child = spawn(command, {
          cwd: cwd ?? options.repositoryRoot,
          shell: true,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeout);

        child.stdout.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        child.on("close", (code) => {
          clearTimeout(timer);

          resolve({
            ok: true,
            stdout,
            stderr: timedOut
              ? `${stderr}\ncommand timed out after ${timeout}ms`.trim()
              : stderr,
            exitCode: typeof code === "number" ? code : 1,
          });
        });

        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({
            ok: true,
            stdout,
            stderr: `${stderr}\n${error.message}`.trim(),
            exitCode: 1,
          });
        });
      });
    },
  };
}

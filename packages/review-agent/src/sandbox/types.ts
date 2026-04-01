import type {
  ListFilesOptions,
  ListFilesResult,
  ReadFileOptions,
  ReadFileResult,
  SearchRepositoryOptions,
  SearchRepositoryResult,
} from "../lib/repo-tools";

export interface RepositoryToolsRunner {
  readFile(path: string, options?: ReadFileOptions): Promise<ReadFileResult>;
  listFiles(path: string, options?: ListFilesOptions): Promise<ListFilesResult>;
  searchRepository(
    query: string,
    options?: SearchRepositoryOptions,
  ): Promise<SearchRepositoryResult>;
  runCommand?(input: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{ ok: true; stdout: string; stderr: string; exitCode: number }>;
}

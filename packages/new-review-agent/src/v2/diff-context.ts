import type { SandboxManager } from "@packages/sandbox";
import { runWithConcurrency } from "./parallel-scheduler";
import { normalizePath, runCommand, textPreview } from "./utils";

export interface DiffCollectionFailure {
  path: string;
  error: string;
  degraded?: boolean;
}

export async function collectPatchesByFile(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
  defaultBranch: string;
  changedFiles: string[];
}): Promise<{
  patchesByFile: Map<string, string>;
  failures: DiffCollectionFailure[];
}> {
  const results = await runWithConcurrency(
    input.changedFiles,
    6,
    async (filePath) => {
      const normalized = normalizePath(filePath);
      const firstAttempt = await runCommand(
        input.sandboxManager,
        input.sandboxId,
        "git",
        [
          "diff",
          "--unified=40",
          `${input.defaultBranch}...HEAD`,
          "--",
          normalized,
        ],
      );

      if (firstAttempt.exitCode === 0) {
        return {
          path: normalized,
          patch: textPreview(firstAttempt.stdout, 12_000),
          failure: null,
        } as const;
      }

      const errorText = firstAttempt.stderr || "git diff failed";

      return {
        path: normalized,
        patch: "",
        failure: {
          path: normalized,
          error: textPreview(errorText, 600),
          degraded: true,
        },
      } as const;
    },
  );

  const patchesByFile = new Map<string, string>();
  const failures: DiffCollectionFailure[] = [];

  for (const item of results) {
    patchesByFile.set(item.path, item.patch);
    if (item.failure) {
      failures.push(item.failure);
    }
  }

  return { patchesByFile, failures };
}

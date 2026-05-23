import type { SandboxManager } from "@packages/sandbox";
import { runWithConcurrency } from "./parallel-scheduler";
import { normalizePath, runCommand, textPreview } from "./utils";
import { debug } from "./debug";

export interface DiffCollectionFailure {
  path: string;
  error: string;
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
  debug("diff-context-start", {
    changedFiles: input.changedFiles.length,
    defaultBranch: input.defaultBranch,
  });

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
        };
      }
      const retryAttempt = await runCommand(
        input.sandboxManager,
        input.sandboxId,
        "git",
        ["diff", "--unified=40", "HEAD~1..HEAD", "--", normalized],
      );
      if (retryAttempt.exitCode === 0) {
        return {
          path: normalized,
          patch: textPreview(retryAttempt.stdout, 12_000),
          failure: null,
        };
      }
      const errorText =
        retryAttempt.stderr || firstAttempt.stderr || "git diff failed";
      return {
        path: normalized,
        patch: "",
        failure: {
          path: normalized,
          error: textPreview(errorText, 600),
        },
      };
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

  debug("diff-context-done", {
    patchesCollected: patchesByFile.size,
    failures: failures.length,
  });

  return { patchesByFile, failures };
}

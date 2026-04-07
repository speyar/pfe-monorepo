import type { SandboxManager } from "@packages/sandbox";
import { runWithConcurrency } from "./parallel-scheduler";
import { normalizePath, runCommand, textPreview } from "./utils";

export async function collectPatchesByFile(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
  defaultBranch: string;
  changedFiles: string[];
}): Promise<Map<string, string>> {
  const pairs = await runWithConcurrency(
    input.changedFiles,
    6,
    async (filePath) => {
      const normalized = normalizePath(filePath);
      const result = await runCommand(
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

      if (result.exitCode !== 0) {
        return [normalized, ""] as const;
      }

      return [normalized, textPreview(result.stdout, 12_000)] as const;
    },
  );

  return new Map<string, string>(pairs);
}

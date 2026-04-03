import type { SandboxManager } from "@packages/sandbox";
import type { GitInput } from "./input";

export function createGitExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: GitInput): Promise<string> => {
    const { operation, args } = input;

    switch (operation) {
      case "diff": {
        const diffArgs = args ? args.split(" ") : ["HEAD~1", "HEAD"];
        const result = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["diff", ...diffArgs],
        });

        if (result.stderr && !result.stderr.includes("warning")) {
          return `Error: ${result.stderr}`;
        }

        return result.stdout || "No changes";
      }

      case "blame": {
        if (!args) {
          return "Error: File path required for git blame.";
        }

        const filePath = args.trim();
        const result = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["blame", filePath],
        });

        if (result.stderr) {
          return `Error: ${result.stderr}`;
        }

        return result.stdout || "No blame information";
      }

      default:
        return "Error: Use 'diff' or 'blame' only. Branch is already set up.";
    }
  };
}

export type GitExecutor = ReturnType<typeof createGitExecutor>;

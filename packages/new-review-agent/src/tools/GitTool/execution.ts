import type { SandboxManager } from "@packages/sandbox";
import type { GitInput } from "./input";

export function createGitExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: GitInput): Promise<string> => {
    const { operation, args } = input;

    switch (operation) {
      case "status": {
        const result = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["status"],
        });

        if (result.stderr && !result.stderr.includes("warning")) {
          return `Error: ${result.stderr}`;
        }

        return result.stdout || "No output";
      }

      case "switch": {
        if (!args) {
          return "Error: Branch name required for git switch. Provide args with branch name.";
        }

        const branchName = args.trim();
        const result = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["switch", branchName],
        });

        if (result.stderr) {
          return `Error: ${result.stderr}`;
        }

        return result.stdout || `Switched to branch '${branchName}'`;
      }

      case "blame": {
        if (!args) {
          return "Error: File path required for git blame. Provide args with file path.";
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

        return result.stdout || "No blame information available";
      }

      default:
        return `Error: Unknown operation '${operation}'. Use 'status', 'switch', or 'blame'.`;
    }
  };
}

export type GitExecutor = ReturnType<typeof createGitExecutor>;

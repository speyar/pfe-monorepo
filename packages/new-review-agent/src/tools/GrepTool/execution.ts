import type { SandboxManager } from "@packages/sandbox";
import type { GrepInput } from "./input";

export function createGrepExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: GrepInput): Promise<string> => {
    const args: string[] = [];

    if (input.options) {
      args.push(...input.options.split(" ").filter(Boolean));
    }

    if (input.maxResults && input.maxResults > 0) {
      if (!input.options?.includes("-m")) {
        args.push("-m", String(input.maxResults));
      }
    }

    args.push("--", input.query);

    if (input.path) {
      args.push(input.path);
    } else {
      args.push(".");
    }

    const result = await manager.runCommand({
      sandboxId,
      command: "rg",
      args,
    });

    if (result.exitCode !== 0) {
      if (
        result.stderr.includes("command not found") ||
        result.stderr.includes("not found")
      ) {
        const grepArgs = [
          "-r",
          ...(input.options ? input.options.split(" ").filter(Boolean) : []),
          input.query,
          input.path || ".",
        ];

        const grepResult = await manager.runCommand({
          sandboxId,
          command: "grep",
          args: grepArgs,
        });

        if (grepResult.stderr) {
          return `Error: ${grepResult.stderr}`;
        }

        return grepResult.stdout || "No matches found.";
      }
      return `Error: ${result.stderr}`;
    }

    return result.stdout || "No matches found.";
  };
}

export type GrepExecutor = ReturnType<typeof createGrepExecutor>;

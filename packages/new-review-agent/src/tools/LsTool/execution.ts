import type { SandboxManager } from "@packages/sandbox";
import type { LsInput } from "./input";

export function createLsExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: LsInput): Promise<string> => {
    const args = [input.path ?? ".", input.options ?? ""]
      .filter(Boolean)
      .join(" ");

    const result = await manager.runCommand({
      sandboxId,
      command: `ls`,
      args: args.split(" "),
    });

    if (result.stderr) {
      return `Error: ${result.stderr}`;
    }

    return result.stdout;
  };
}

export type LsExecutor = ReturnType<typeof createLsExecutor>;

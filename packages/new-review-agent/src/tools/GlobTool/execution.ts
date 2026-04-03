import type { SandboxManager } from "@packages/sandbox";
import type { GlobInput } from "./input";

export function createGlobExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: GlobInput): Promise<string> => {
    const searchPath = input.path || ".";

    let typeFilter = "";
    if (input.type === "f") {
      typeFilter = "-type f";
    } else if (input.type === "d") {
      typeFilter = "-type d";
    }

    let findPattern = input.pattern;
    if (!findPattern.includes("*") && !findPattern.includes("?")) {
      findPattern = `*${findPattern}*`;
    }

    const escapedPattern = findPattern.replace(/'/g, "'\\''");

    let args: string[];
    if (typeFilter) {
      args = [searchPath, "-name", `'${escapedPattern}'`, typeFilter];
    } else {
      args = [searchPath, "-name", `'${escapedPattern}'`];
    }

    if (input.maxResults) {
      args.push("-maxdepth", String(input.maxResults));
    }

    const result = await manager.runCommand({
      sandboxId,
      command: "find",
      args,
    });

    if (result.stderr && !result.stderr.includes("Permission denied")) {
      return `Error: ${result.stderr}`;
    }

    const output = result.stdout.trim();
    if (!output) {
      return "No files found.";
    }

    const lines = output.split("\n").filter(Boolean);
    const limited = input.maxResults ? lines.slice(0, input.maxResults) : lines;

    return limited.join("\n");
  };
}

export type GlobExecutor = ReturnType<typeof createGlobExecutor>;

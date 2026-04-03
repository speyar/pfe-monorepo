import type { SandboxManager } from "@packages/sandbox";
import type { ReadFileInput } from "./input";

export function createReadFileExecutor(
  manager: SandboxManager,
  sandboxId: string,
) {
  return async (input: ReadFileInput): Promise<string> => {
    const args: string[] = [];

    if (input.options) {
      args.push(...input.options.split(" ").filter(Boolean));
    }

    if (input.lineStart && input.lineEnd) {
      args.push(
        "-s",
        String(input.lineStart),
        String(input.lineEnd),
        input.path,
      );
    } else if (input.lineStart && !input.lineEnd) {
      args.push("-s", String(input.lineStart), "$", input.path);
    } else if (input.maxLines) {
      args.push("-s", "1", String(input.maxLines), input.path);
    } else {
      args.push(input.path);
    }

    let command = "sed";
    let sedArgs: string[];

    if (input.lineStart || input.maxLines) {
      let startLine = input.lineStart ?? 1;
      let endLine = input.lineEnd ?? input.maxLines ?? "$";

      if (input.maxLines && !input.lineEnd) {
        endLine = String(input.maxLines);
      }

      sedArgs = ["-n", `${startLine},${endLine}p`, input.path];
    } else {
      sedArgs = args;
      command = "cat";
    }

    const catResult = await manager.runCommand({
      sandboxId,
      command,
      args: command === "cat" ? args.slice(1) : sedArgs,
    });

    if (catResult.stderr && !catResult.stderr.includes("Permission denied")) {
      return `Error: ${catResult.stderr}`;
    }

    const output = catResult.stdout;
    if (!output || output.trim() === "") {
      return `Error: File is empty or not found: ${input.path}`;
    }

    return output;
  };
}

export type ReadFileExecutor = ReturnType<typeof createReadFileExecutor>;

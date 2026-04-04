import type { SandboxManager } from "@packages/sandbox";
import type { GlobInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
  toSandboxPath,
  truncateByLines,
} from "../shared";

export function createGlobExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: GlobInput): Promise<string> => {
    logToolEvent({ tool: "glob", phase: "start", payload: input });

    try {
      const searchPath = toSandboxPath(input.path ?? ".");
      const pattern = input.pattern.trim();

      const args: string[] = [searchPath, "-name", pattern];

      if (input.type === "f" || input.type === "d") {
        args.push("-type", input.type);
      }

      const rawResult = await manager.runCommand({
        sandboxId,
        command: "find",
        args,
      });
      const result = normalizeCommandResult(rawResult);

      if (result.exitCode !== 0 && result.stderr) {
        const errorMessage = `Error: ${result.stderr}`;
        logToolEvent({
          tool: "glob",
          phase: "finish",
          payload: {
            exitCode: result.exitCode,
            error: previewText(errorMessage),
          },
        });
        return errorMessage;
      }

      const output = result.stdout.trim();
      if (!output) {
        logToolEvent({
          tool: "glob",
          phase: "finish",
          payload: { exitCode: result.exitCode, output: "No files found." },
        });
        return "No files found.";
      }

      const lines = output.split("\n").filter(Boolean);
      const limited = input.maxResults
        ? lines.slice(0, input.maxResults)
        : lines;

      const resultOutput = truncateByLines(limited.join("\n"), 200);
      logToolEvent({
        tool: "glob",
        phase: "finish",
        payload: {
          exitCode: result.exitCode,
          output: previewText(resultOutput),
        },
      });
      return resultOutput;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "glob",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type GlobExecutor = ReturnType<typeof createGlobExecutor>;

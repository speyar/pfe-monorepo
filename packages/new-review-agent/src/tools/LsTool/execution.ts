import type { SandboxManager } from "@packages/sandbox";
import type { LsInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
  splitOptions,
  toSandboxPath,
  truncateByLines,
} from "../shared";

export function createLsExecutor(manager: SandboxManager, sandboxId: string) {
  return async (input: LsInput): Promise<string> => {
    logToolEvent({ tool: "ls", phase: "start", payload: input });

    try {
      const args = [
        ...splitOptions(input.options),
        toSandboxPath(input.path ?? "."),
      ];

      const rawResult = await manager.runCommand({
        sandboxId,
        command: "ls",
        args,
      });
      const result = normalizeCommandResult(rawResult);

      if (result.exitCode !== 0 && result.stderr) {
        const errorMessage = `Error: ${result.stderr}`;
        logToolEvent({
          tool: "ls",
          phase: "finish",
          payload: {
            exitCode: result.exitCode,
            error: previewText(errorMessage),
          },
        });
        return errorMessage;
      }

      if (!result.stdout) {
        logToolEvent({
          tool: "ls",
          phase: "finish",
          payload: { exitCode: result.exitCode, output: "No entries found." },
        });
        return "No entries found.";
      }

      const output = truncateByLines(result.stdout, 200);
      logToolEvent({
        tool: "ls",
        phase: "finish",
        payload: { exitCode: result.exitCode, output: previewText(output) },
      });
      return output;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "ls",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type LsExecutor = ReturnType<typeof createLsExecutor>;

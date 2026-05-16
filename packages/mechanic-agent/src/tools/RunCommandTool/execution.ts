import type { SandboxManager } from "@packages/sandbox";
import type { RunCommandInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
} from "../shared";

export function createRunCommandExecutor(
  manager: SandboxManager,
  sandboxId: string,
) {
  return async (input: RunCommandInput): Promise<string> => {
    logToolEvent({ tool: "runCommand", phase: "start", payload: input });

    try {
      const args = input.command.split(/\s+/);
      const cmd = args[0] ?? input.command;
      const cmdArgs = args.length > 1 ? args.slice(1) : [];

      const rawResult = await manager.runCommand({
        sandboxId,
        command: cmd,
        args: cmdArgs,
        cwd: input.workdir,
      });
      const result = normalizeCommandResult(rawResult);

      const output = [
        `Exit code: ${result.exitCode}`,
        result.stdout ? `\nstdout:\n${result.stdout}` : "",
        result.stderr ? `\nstderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      logToolEvent({
        tool: "runCommand",
        phase: "finish",
        payload: {
          command: input.command,
          exitCode: result.exitCode,
          output: previewText(output),
        },
      });

      return output;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "runCommand",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type RunCommandExecutor = ReturnType<typeof createRunCommandExecutor>;

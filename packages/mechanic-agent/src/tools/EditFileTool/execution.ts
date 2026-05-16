import type { SandboxManager } from "@packages/sandbox";
import type { EditFileInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
} from "../shared";

export function createEditFileExecutor(
  manager: SandboxManager,
  sandboxId: string,
) {
  return async (input: EditFileInput): Promise<string> => {
    logToolEvent({ tool: "editFile", phase: "start", payload: input });

    try {
      const searchEscaped = input.search
        .replace(/\\/g, "\\\\")
        .replace(/\//g, "\\/")
        .replace(/\./g, "\\.")
        .replace(/\*/g, "\\*")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/\$/g, "\\$")
        .replace(/&/g, "\\&");

      const replaceEscaped = input.replace
        .replace(/\\/g, "\\\\")
        .replace(/&/g, "\\&")
        .replace(/\//g, "\\/")
        .replace(/\n/g, "\\n");

      const sedResult = await manager.runCommand({
        sandboxId,
        command: "sed",
        args: [
          "-i",
          "",
          `s/${searchEscaped}/${replaceEscaped}/`,
          input.path,
        ],
      });
      const normalized = normalizeCommandResult(sedResult);

      if (normalized.exitCode !== 0) {
        const errorMessage = `Error editing file: ${normalized.stderr || "sed failed"}`;
        logToolEvent({
          tool: "editFile",
          phase: "finish",
          payload: {
            exitCode: normalized.exitCode,
            error: previewText(errorMessage),
          },
        });
        return errorMessage;
      }

      logToolEvent({
        tool: "editFile",
        phase: "finish",
        payload: { path: input.path, success: true },
      });
      return `Successfully edited ${input.path}`;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "editFile",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type EditFileExecutor = ReturnType<typeof createEditFileExecutor>;

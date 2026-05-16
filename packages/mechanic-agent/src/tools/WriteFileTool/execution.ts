import type { SandboxManager } from "@packages/sandbox";
import type { WriteFileInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
} from "../shared";

export function createWriteFileExecutor(
  manager: SandboxManager,
  sandboxId: string,
) {
  return async (input: WriteFileInput): Promise<string> => {
    logToolEvent({ tool: "writeFile", phase: "start", payload: input });

    try {
      const escapedContent = input.content.replace(/'/g, "'\\''");
      const result = await manager.runCommand({
        sandboxId,
        command: "bash",
        args: ["-c", `cat > '${input.path}' << 'ENDOFFILE'\n${input.content}\nENDOFFILE`],
      });
      const normalized = normalizeCommandResult(result);

      if (normalized.exitCode !== 0) {
        const errorMessage = `Error writing file: ${normalized.stderr || "Unknown error"}`;
        logToolEvent({
          tool: "writeFile",
          phase: "finish",
          payload: {
            exitCode: normalized.exitCode,
            error: previewText(errorMessage),
          },
        });
        return errorMessage;
      }

      logToolEvent({
        tool: "writeFile",
        phase: "finish",
        payload: { path: input.path, success: true },
      });
      return `Successfully wrote ${input.path}`;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "writeFile",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type WriteFileExecutor = ReturnType<typeof createWriteFileExecutor>;

import type { SandboxManager } from "@packages/sandbox";
import type { ReadFileInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
  splitOptions,
  toSandboxPath,
  truncateByLines,
} from "../shared";

export function createReadFileExecutor(
  manager: SandboxManager,
  sandboxId: string,
) {
  const seen = new Set<string>();

  return async (input: ReadFileInput): Promise<string> => {
    logToolEvent({ tool: "readFile", phase: "start", payload: input });

    try {
      const callKey = JSON.stringify({
        path: input.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        maxLines: input.maxLines,
        options: input.options,
      });
      if (seen.has(callKey)) {
        const duplicateMessage =
          "Error: Duplicate readFile call. Choose another file/range.";
        logToolEvent({
          tool: "readFile",
          phase: "finish",
          payload: { error: duplicateMessage },
        });
        return duplicateMessage;
      }
      seen.add(callKey);

      const path = toSandboxPath(input.path);
      const baseArgs = splitOptions(input.options);

      const hasLineRange =
        input.lineStart !== undefined ||
        input.lineEnd !== undefined ||
        input.maxLines !== undefined;

      if (!hasLineRange) {
        const catRawResult = await manager.runCommand({
          sandboxId,
          command: "cat",
          args: [...baseArgs, path],
        });
        const catResult = normalizeCommandResult(catRawResult);

        if (catResult.exitCode !== 0) {
          const errorMessage = `Error: ${catResult.stderr || `Failed to read file: ${path}`}`;
          logToolEvent({
            tool: "readFile",
            phase: "finish",
            payload: {
              exitCode: catResult.exitCode,
              error: previewText(errorMessage),
            },
          });
          return errorMessage;
        }

        if (catResult.stdout.length === 0) {
          const emptyMessage = `File is empty: ${path}`;
          logToolEvent({
            tool: "readFile",
            phase: "finish",
            payload: { exitCode: catResult.exitCode, output: emptyMessage },
          });
          return emptyMessage;
        }

        const output = truncateByLines(catResult.stdout, 250);
        logToolEvent({
          tool: "readFile",
          phase: "finish",
          payload: {
            exitCode: catResult.exitCode,
            output: previewText(output),
          },
        });
        return output;
      }

      const startLine = input.lineStart ?? 1;
      let endLine: string;

      if (input.lineEnd !== undefined) {
        endLine = String(input.lineEnd);
      } else if (input.maxLines !== undefined) {
        endLine = String(Math.max(startLine, startLine + input.maxLines - 1));
      } else {
        endLine = "$";
      }

      const sedRawResult = await manager.runCommand({
        sandboxId,
        command: "sed",
        args: ["-n", `${startLine},${endLine}p`, path],
      });
      const sedResult = normalizeCommandResult(sedRawResult);

      if (sedResult.exitCode !== 0) {
        const errorMessage = `Error: ${sedResult.stderr || `Failed to read file: ${path}`}`;
        logToolEvent({
          tool: "readFile",
          phase: "finish",
          payload: {
            exitCode: sedResult.exitCode,
            error: previewText(errorMessage),
          },
        });
        return errorMessage;
      }

      const output = sedResult.stdout;
      if (!output || output.trim() === "") {
        const emptyRangeMessage = `No content in selected range for file: ${path}`;
        logToolEvent({
          tool: "readFile",
          phase: "finish",
          payload: { exitCode: sedResult.exitCode, output: emptyRangeMessage },
        });
        return emptyRangeMessage;
      }

      const truncatedOutput = truncateByLines(output, 250);
      logToolEvent({
        tool: "readFile",
        phase: "finish",
        payload: {
          exitCode: sedResult.exitCode,
          output: previewText(truncatedOutput),
        },
      });
      return truncatedOutput;
    } catch (error) {
      const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
      logToolEvent({
        tool: "readFile",
        phase: "finish",
        payload: { error: previewText(errorMessage) },
      });
      return errorMessage;
    }
  };
}

export type ReadFileExecutor = ReturnType<typeof createReadFileExecutor>;

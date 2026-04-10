import type { SandboxManager } from "@packages/sandbox";
import type { ReadFileInput } from "./input";
import {
  estimateTokenCount,
  logToolEvent,
  normalizeCommandResult,
  previewText,
  splitOptions,
  toSandboxPath,
  truncateByLines,
  truncateByTokens,
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
        const wcRawResult = await manager.runCommand({
          sandboxId,
          command: "wc",
          args: ["-l", path],
        });
        const wcResult = normalizeCommandResult(wcRawResult);

        if (wcResult.exitCode !== 0) {
          const rangeRequiredMessage =
            "Error: readFile requires lineStart/lineEnd or maxLines for this file. Use grep first, then read a focused range.";
          logToolEvent({
            tool: "readFile",
            phase: "finish",
            payload: {
              exitCode: wcResult.exitCode,
              error: previewText(rangeRequiredMessage),
            },
          });
          return rangeRequiredMessage;
        }

        const lineCountMatch = wcResult.stdout.trim().match(/^(\d+)/);
        const lineCount = lineCountMatch ? Number(lineCountMatch[1]) : NaN;

        if (!Number.isFinite(lineCount) || lineCount > 120) {
          const rangeRequiredMessage =
            "Error: Full-file read blocked for files over 120 lines. Use grep first, then call readFile with lineStart/lineEnd or maxLines.";
          logToolEvent({
            tool: "readFile",
            phase: "finish",
            payload: {
              lineCount: Number.isFinite(lineCount) ? lineCount : undefined,
              error: previewText(rangeRequiredMessage),
            },
          });
          return rangeRequiredMessage;
        }

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

        // Handle maxTokens parameter for full file reading
        let output = catResult.stdout;
        let tokenInfo = {};

        if (input.maxTokens !== undefined) {
          const {
            text: truncatedText,
            truncated,
            estimatedTokens,
          } = truncateByTokens(catResult.stdout, input.maxTokens);
          output = truncatedText;

          // Add token metadata to help guide chunked reading
          const totalEstimatedTokens = estimateTokenCount(catResult.stdout);
          tokenInfo = {
            truncated,
            estimatedTokens: estimatedTokens,
            totalEstimatedTokens,
            suggestedNextOffset: truncated
              ? Math.floor(
                  (estimatedTokens / totalEstimatedTokens) * lineCount,
                ) + 1
              : undefined,
          };
        } else {
          output = truncateByLines(catResult.stdout, 250);
        }

        // Add metadata header if we have token info
        let finalOutput = output;
        if (Object.keys(tokenInfo).length > 0) {
          const {
            truncated,
            estimatedTokens,
            totalEstimatedTokens,
            suggestedNextOffset,
          } = tokenInfo as {
            truncated: boolean;
            estimatedTokens: number;
            totalEstimatedTokens: number;
            suggestedNextOffset?: number;
          };

          let metadata = `[FILE_TOKENS: estimated=${totalEstimatedTokens}|returned=${estimatedTokens}|max_limit=${input.maxTokens ?? "none"}]\n`;
          metadata += `[FILE_LINES: total=${lineCount}|returned=1-${lineCount}]\n`;
          metadata += `[TRUNCATED: ${truncated}]\n`;

          if (truncated && suggestedNextOffset !== undefined) {
            metadata += `[NEXT_SUGGESTED_OFFSET: ${suggestedNextOffset}]\n`;
          }

          metadata += "---\n";
          finalOutput = metadata + output;
        }

        logToolEvent({
          tool: "readFile",
          phase: "finish",
          payload: {
            exitCode: catResult.exitCode,
            output: previewText(finalOutput),
          },
        });
        return finalOutput;
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

      // Handle maxTokens parameter for ranged reading
      let finalOutput = output;
      let tokenInfo = {};

      if (input.maxTokens !== undefined) {
        const {
          text: truncatedText,
          truncated,
          estimatedTokens,
        } = truncateByTokens(output, input.maxTokens);
        finalOutput = truncatedText;

        // Add token metadata to help guide chunked reading
        const totalEstimatedTokens = estimateTokenCount(output);
        // Calculate line count for the current range
        const rangeLineCount = input.lineEnd
          ? input.lineEnd - (input.lineStart ?? 1) + 1
          : (input.maxLines ?? 250); // Default to truncation limit if neither specified
        tokenInfo = {
          truncated,
          estimatedTokens: estimatedTokens,
          totalEstimatedTokens,
          suggestedNextOffset: truncated
            ? Math.floor(
                (estimatedTokens / totalEstimatedTokens) * rangeLineCount,
              ) + (input.lineStart ?? 1)
            : undefined,
        };
      } else {
        finalOutput = truncateByLines(output, 250);
      }

      // Add metadata header if we have token info
      if (Object.keys(tokenInfo).length > 0) {
        const {
          truncated,
          estimatedTokens,
          totalEstimatedTokens,
          suggestedNextOffset,
        } = tokenInfo as {
          truncated: boolean;
          estimatedTokens: number;
          totalEstimatedTokens: number;
          suggestedNextOffset?: number;
        };

        let metadata = `[FILE_TOKENS: estimated=${totalEstimatedTokens}|returned=${estimatedTokens}|max_limit=${input.maxTokens ?? "none"}]\n`;
        const rangeLineCount = input.lineEnd
          ? input.lineEnd - (input.lineStart ?? 1) + 1
          : (input.maxLines ?? 250);
        metadata += `[FILE_LINES: total=${rangeLineCount}|returned=${input.lineStart ?? 1}-${input.lineEnd ?? rangeLineCount}]\n`;
        metadata += `[TRUNCATED: ${truncated}]\n`;

        if (truncated && suggestedNextOffset !== undefined) {
          metadata += `[NEXT_SUGGESTED_OFFSET: ${suggestedNextOffset}]\n`;
        }

        metadata += "---\n";
        finalOutput = metadata + finalOutput;
      }

      logToolEvent({
        tool: "readFile",
        phase: "finish",
        payload: {
          exitCode: sedResult.exitCode,
          output: previewText(finalOutput),
        },
      });
      return finalOutput;
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

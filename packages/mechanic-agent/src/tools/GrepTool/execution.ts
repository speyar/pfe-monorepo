import type { SandboxManager } from "@packages/sandbox";
import type { GrepInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
  splitOptions,
  toSandboxPath,
  truncateByLines,
} from "../shared";

export function createGrepExecutor(manager: SandboxManager, sandboxId: string) {
  const seen = new Set<string>();

  return async (input: GrepInput): Promise<string> => {
    logToolEvent({ tool: "grep", phase: "start", payload: input });

    const dedupeKey = JSON.stringify({
      query: input.query,
      path: input.path,
      options: input.options,
      maxResults: input.maxResults,
    });
    if (seen.has(dedupeKey)) {
      const duplicateMessage =
        "Error: Duplicate grep call. Refine query or path.";
      logToolEvent({
        tool: "grep",
        phase: "finish",
        payload: { error: duplicateMessage },
      });
      return duplicateMessage;
    }
    seen.add(dedupeKey);

    const rawOptions = splitOptions(input.options);
    const args: string[] = [];

    for (const token of rawOptions) {
      if (token === "-r" || token === "-R") {
        continue;
      }
      args.push(token);
    }

    const query = input.query.trim();
    const searchPath = toSandboxPath(input.path ?? ".");

    if (input.maxResults && input.maxResults > 0 && !args.includes("-m")) {
      args.push("-m", String(input.maxResults));
    }

    args.push("--", query, searchPath);

    let rgResult:
      | { stdout: string; stderr: string; exitCode: number }
      | undefined;
    let rgThrew = false;
    try {
      const rgRawResult = await manager.runCommand({
        sandboxId,
        command: "rg",
        args,
      });
      rgResult = normalizeCommandResult(rgRawResult);
    } catch {
      rgThrew = true;
    }

    if (rgResult) {
      if (rgResult.exitCode === 0) {
        const output = truncateByLines(
          rgResult.stdout || "No matches found.",
          200,
        );
        logToolEvent({
          tool: "grep",
          phase: "finish",
          payload: { exitCode: rgResult.exitCode, output: previewText(output) },
        });
        return output;
      }

      if (rgResult.exitCode === 1) {
        logToolEvent({
          tool: "grep",
          phase: "finish",
          payload: { exitCode: rgResult.exitCode, output: "No matches found." },
        });
        return "No matches found.";
      }
    }

    const shouldFallback =
      rgThrew ||
      (rgResult &&
        (rgResult.stderr.includes("command not found") ||
          rgResult.stderr.includes("not found") ||
          rgResult.stderr.includes("executable_not_found")));

    if (shouldFallback) {
      const fallbackArgs = [
        ...splitOptions(input.options),
        "-R",
        "-n",
        query,
        searchPath,
      ];

      if (
        input.maxResults &&
        input.maxResults > 0 &&
        !fallbackArgs.includes("-m")
      ) {
        fallbackArgs.push("-m", String(input.maxResults));
      }

      try {
        const grepRawResult = await manager.runCommand({
          sandboxId,
          command: "grep",
          args: fallbackArgs,
        });
        const grepResult = normalizeCommandResult(grepRawResult);

        if (grepResult.exitCode === 0) {
          const output = truncateByLines(
            grepResult.stdout || "No matches found.",
            200,
          );
          logToolEvent({
            tool: "grep",
            phase: "finish",
            payload: {
              exitCode: grepResult.exitCode,
              fallback: true,
              output: previewText(output),
            },
          });
          return output;
        }

        if (grepResult.exitCode === 1) {
          logToolEvent({
            tool: "grep",
            phase: "finish",
            payload: {
              exitCode: grepResult.exitCode,
              fallback: true,
              output: "No matches found.",
            },
          });
          return "No matches found.";
        }

        if (grepResult.stderr) {
          const errorMessage = `Error: ${grepResult.stderr}`;
          logToolEvent({
            tool: "grep",
            phase: "finish",
            payload: {
              exitCode: grepResult.exitCode,
              fallback: true,
              error: previewText(errorMessage),
            },
          });
          return errorMessage;
        }

        logToolEvent({
          tool: "grep",
          phase: "finish",
          payload: {
            exitCode: grepResult.exitCode,
            fallback: true,
            output: "No matches found.",
          },
        });
        return "No matches found.";
      } catch (error) {
        const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
        logToolEvent({
          tool: "grep",
          phase: "finish",
          payload: { fallback: true, error: previewText(errorMessage) },
        });
        return errorMessage;
      }
    }

    const errorMessage = `Error: ${rgResult?.stderr || "Search failed."}`;
    logToolEvent({
      tool: "grep",
      phase: "finish",
      payload: {
        exitCode: rgResult?.exitCode,
        error: previewText(errorMessage),
      },
    });
    return errorMessage;
  };
}

export type GrepExecutor = ReturnType<typeof createGrepExecutor>;

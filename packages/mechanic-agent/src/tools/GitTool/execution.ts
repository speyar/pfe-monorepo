import type { SandboxManager } from "@packages/sandbox";
import type { GitInput } from "./input";
import {
  logToolEvent,
  normalizeCommandResult,
  previewText,
  splitOptions,
  truncateByLines,
} from "../shared";

export function createGitExecutor(manager: SandboxManager, sandboxId: string) {
  const seen = new Set<string>();

  return async (input: GitInput): Promise<string> => {
    logToolEvent({ tool: "git", phase: "start", payload: input });

    const { operation, args } = input;
    const dedupeKey = `${operation}:${args ?? ""}`;
    if (seen.has(dedupeKey)) {
      const duplicateMessage =
        "Error: Duplicate git call. Use a different operation/args.";
      logToolEvent({
        tool: "git",
        phase: "finish",
        payload: { error: duplicateMessage },
      });
      return duplicateMessage;
    }
    seen.add(dedupeKey);

    switch (operation) {
      case "diff": {
        const diffArgs = args ? splitOptions(args) : ["HEAD~1..HEAD"];
        if (diffArgs.length === 0) {
          diffArgs.push("HEAD~1..HEAD");
        }
        const rawResult = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["diff", ...diffArgs],
        });
        const result = normalizeCommandResult(rawResult);

        if (result.exitCode !== 0 && result.stderr) {
          const errorMessage = `Error: ${result.stderr}`;
          logToolEvent({
            tool: "git",
            phase: "finish",
            payload: {
              operation,
              exitCode: result.exitCode,
              error: previewText(errorMessage),
            },
          });
          return errorMessage;
        }

        if (!result.stdout) {
          logToolEvent({
            tool: "git",
            phase: "finish",
            payload: {
              operation,
              exitCode: result.exitCode,
              output: "No changes",
            },
          });
          return "No changes";
        }

        const output = truncateByLines(result.stdout, 250);
        logToolEvent({
          tool: "git",
          phase: "finish",
          payload: {
            operation,
            exitCode: result.exitCode,
            output: previewText(output),
          },
        });
        return output;
      }

      case "blame": {
        if (!args) {
          const errorMessage = "Error: File path required for git blame.";
          logToolEvent({
            tool: "git",
            phase: "finish",
            payload: { operation, error: errorMessage },
          });
          return errorMessage;
        }

        const filePath = args.trim();
        const rawResult = await manager.runCommand({
          sandboxId,
          command: "git",
          args: ["blame", filePath],
        });
        const result = normalizeCommandResult(rawResult);

        if (result.exitCode !== 0 && result.stderr) {
          const errorMessage = `Error: ${result.stderr}`;
          logToolEvent({
            tool: "git",
            phase: "finish",
            payload: {
              operation,
              exitCode: result.exitCode,
              error: previewText(errorMessage),
            },
          });
          return errorMessage;
        }

        if (!result.stdout) {
          logToolEvent({
            tool: "git",
            phase: "finish",
            payload: {
              operation,
              exitCode: result.exitCode,
              output: "No blame information",
            },
          });
          return "No blame information";
        }

        const output = truncateByLines(result.stdout, 300);
        logToolEvent({
          tool: "git",
          phase: "finish",
          payload: {
            operation,
            exitCode: result.exitCode,
            output: previewText(output),
          },
        });
        return output;
      }

      default: {
        const errorMessage =
          "Error: Use 'diff' or 'blame' only. Branch is already set up.";
        logToolEvent({
          tool: "git",
          phase: "finish",
          payload: { operation, error: errorMessage },
        });
        return errorMessage;
      }
    }
  };
}

export type GitExecutor = ReturnType<typeof createGitExecutor>;

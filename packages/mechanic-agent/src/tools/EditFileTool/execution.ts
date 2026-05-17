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
      const script = [
        `const fs = require('fs');`,
        `const p = ${JSON.stringify(input.path)};`,
        `const s = ${JSON.stringify(input.search)};`,
        `const r = ${JSON.stringify(input.replace)};`,
        `let c = fs.readFileSync(p, 'utf-8');`,
        `const idx = c.indexOf(s);`,
        `if (idx === -1) {`,
        `  console.log('NOT_FOUND: search text not found in file');`,
        `  process.exit(1);`,
        `}`,
        `c = c.slice(0, idx) + r + c.slice(idx + s.length);`,
        `fs.writeFileSync(p, c, 'utf-8');`,
        `console.log('EDITED ' + p);`,
      ].join("\n");

      const result = await manager.runCommand({
        sandboxId,
        command: "node",
        args: ["-e", script],
      });
      const normalized = normalizeCommandResult(result);

      if (normalized.exitCode !== 0) {
        const errorMessage = `Error editing file: ${normalized.stderr || normalized.stdout || "edit failed"}`;
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

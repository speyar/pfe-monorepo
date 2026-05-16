import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { EDITFILE_TOOL_PROMPT } from "./prompt";
import { EditFileInputSchema, type EditFileInput } from "./input";
import { createEditFileExecutor } from "./execution";

export function createEditFileTool(manager: SandboxManager, sandboxId: string) {
  const executor = createEditFileExecutor(manager, sandboxId);

  return tool({
    description: EDITFILE_TOOL_PROMPT,
    inputSchema: EditFileInputSchema,
    execute: async (input: EditFileInput) => {
      return executor(input);
    },
  });
}

export type EditFileTool = ReturnType<typeof createEditFileTool>;

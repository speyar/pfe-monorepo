import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { WRITEFILE_TOOL_PROMPT } from "./prompt";
import { WriteFileInputSchema, type WriteFileInput } from "./input";
import { createWriteFileExecutor } from "./execution";

export function createWriteFileTool(manager: SandboxManager, sandboxId: string) {
  const executor = createWriteFileExecutor(manager, sandboxId);

  return tool({
    description: WRITEFILE_TOOL_PROMPT,
    inputSchema: WriteFileInputSchema,
    execute: async (input: WriteFileInput) => {
      return executor(input);
    },
  });
}

export type WriteFileTool = ReturnType<typeof createWriteFileTool>;

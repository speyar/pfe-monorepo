import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { READFILE_TOOL_PROMPT } from "./prompt";
import { ReadFileInputSchema, type ReadFileInput } from "./input";
import { createReadFileExecutor } from "./execution";

export function createReadFileTool(manager: SandboxManager, sandboxId: string) {
  const executor = createReadFileExecutor(manager, sandboxId);

  return tool({
    description: READFILE_TOOL_PROMPT,
    inputSchema: ReadFileInputSchema,
    execute: async (input: ReadFileInput) => {
      return executor(input);
    },
  });
}

export type ReadFileTool = ReturnType<typeof createReadFileTool>;

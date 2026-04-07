import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { GLOB_TOOL_PROMPT } from "./prompt";
import { GlobInputSchema, type GlobInput } from "./input";
import { createGlobExecutor } from "./execution";

export function createGlobTool(manager: SandboxManager, sandboxId: string) {
  const executor = createGlobExecutor(manager, sandboxId);

  return tool({
    description: GLOB_TOOL_PROMPT,
    inputSchema: GlobInputSchema,
    execute: async (input: GlobInput) => {
      return executor(input);
    },
  });
}

export type GlobTool = ReturnType<typeof createGlobTool>;

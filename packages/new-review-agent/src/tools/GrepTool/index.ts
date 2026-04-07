import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { GREP_TOOL_PROMPT } from "./prompt";
import { GrepInputSchema, type GrepInput } from "./input";
import { createGrepExecutor } from "./execution";

export function createGrepTool(manager: SandboxManager, sandboxId: string) {
  const executor = createGrepExecutor(manager, sandboxId);

  return tool({
    description: GREP_TOOL_PROMPT,
    inputSchema: GrepInputSchema,
    execute: async (input: GrepInput) => {
      return executor(input);
    },
  });
}

export type GrepTool = ReturnType<typeof createGrepTool>;

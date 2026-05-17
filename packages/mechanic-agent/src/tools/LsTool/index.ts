import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { LS_TOOL_PROMPT } from "./prompt";
import { LsInputSchema, type LsInput } from "./input";
import { createLsExecutor } from "./execution";

export function createLsTool(manager: SandboxManager, sandboxId: string) {
  const executor = createLsExecutor(manager, sandboxId);

  return tool({
    description: LS_TOOL_PROMPT,
    inputSchema: LsInputSchema,
    execute: async (input: LsInput) => {
      return executor(input);
    },
  });
}

export type LsTool = ReturnType<typeof createLsTool>;

import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { RUNCOMMAND_TOOL_PROMPT } from "./prompt";
import { RunCommandInputSchema, type RunCommandInput } from "./input";
import { createRunCommandExecutor } from "./execution";

export function createRunCommandTool(manager: SandboxManager, sandboxId: string) {
  const executor = createRunCommandExecutor(manager, sandboxId);

  return tool({
    description: RUNCOMMAND_TOOL_PROMPT,
    inputSchema: RunCommandInputSchema,
    execute: async (input: RunCommandInput) => {
      return executor(input);
    },
  });
}

export type RunCommandTool = ReturnType<typeof createRunCommandTool>;

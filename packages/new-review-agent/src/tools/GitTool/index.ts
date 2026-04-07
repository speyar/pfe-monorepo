import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { GIT_TOOL_PROMPT } from "./prompt";
import { GitInputSchema, type GitInput } from "./input";
import { createGitExecutor } from "./execution";

export function createGitTool(manager: SandboxManager, sandboxId: string) {
  const executor = createGitExecutor(manager, sandboxId);

  return tool({
    description: GIT_TOOL_PROMPT,
    inputSchema: GitInputSchema,
    execute: async (input: GitInput) => {
      return executor(input);
    },
  });
}

export type GitTool = ReturnType<typeof createGitTool>;

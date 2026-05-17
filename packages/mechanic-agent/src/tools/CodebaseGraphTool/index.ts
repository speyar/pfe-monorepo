import { tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { CODEBASE_GRAPH_TOOL_PROMPT } from "./prompt";
import { CodebaseGraphInputSchema, type CodebaseGraphInput } from "./input";
import { createCodebaseGraphExecutor } from "./execution";

export function createCodebaseGraphTool(
  manager: SandboxManager,
  sandboxId: string,
  graphPath: string,
) {
  const executor = createCodebaseGraphExecutor(manager, sandboxId, graphPath);

  return tool({
    description: CODEBASE_GRAPH_TOOL_PROMPT,
    inputSchema: CodebaseGraphInputSchema,
    execute: async (input: CodebaseGraphInput) => {
      return executor(input);
    },
  });
}

export type CodebaseGraphTool = ReturnType<typeof createCodebaseGraphTool>;

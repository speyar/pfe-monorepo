import { tool } from "ai";
import { REQUEST_SKILL_TOOL_PROMPT } from "./prompt";
import { RequestSkillInputSchema, type RequestSkillInput } from "./input";
import { createRequestSkillExecutor, type Skill } from "./execution";

export function createRequestSkillTool(skills: Skill[]) {
  const executor = createRequestSkillExecutor(skills);

  return tool({
    description: REQUEST_SKILL_TOOL_PROMPT,
    inputSchema: RequestSkillInputSchema,
    execute: async (input: RequestSkillInput) => {
      return executor(input);
    },
  });
}

export type RequestSkillTool = ReturnType<typeof createRequestSkillTool>;

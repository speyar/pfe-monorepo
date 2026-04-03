import { generateText, Output, stepCountIs, type LanguageModel } from "ai";

import { reviewResultSchema } from "./schema/review-result";
import { REVIEW_AGENT_SYSTEM_PROMPT } from "./prompts/review-agent";
import { buildReviewPrompt } from "./prompts/build-review-prompt";
import { createLsTool } from "./tools/LsTool";
import { createGrepTool } from "./tools/GrepTool";
import { createGlobTool } from "./tools/GlobTool";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGitTool } from "./tools/GitTool";
import type { SandboxManager } from "@packages/sandbox";

export interface ReviewAgentOptions {
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  maxToolSteps?: number;
  signal?: AbortSignal;
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
}

export async function runReviewAgent(
  branchName: string,
  options: ReviewAgentOptions,
): Promise<ReviewResult> {
  const { sandboxManager, sandboxId } = options;

  const tools = {
    ls: createLsTool(sandboxManager, sandboxId),
    grep: createGrepTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    git: createGitTool(sandboxManager, sandboxId),
  };

  const generation = await generateText({
    model: options.model,
    system: REVIEW_AGENT_SYSTEM_PROMPT,
    prompt: buildReviewPrompt(branchName),
    tools,
    toolChoice: "required",
    stopWhen: stepCountIs(options.maxToolSteps ?? 15),
    output: Output.object({
      schema: reviewResultSchema,
      name: "review_result",
      description: "PR review findings",
    }),
    abortSignal: options.signal,
  });

  return generation.output as ReviewResult;
}

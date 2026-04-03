import { generateText, stepCountIs, type LanguageModel } from "ai";

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
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
}

function parseJsonResponse(text: string): ReviewResult {
  const cleaned = text.trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { findings: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return reviewResultSchema.parse(parsed);
  } catch {
    return { findings: [] };
  }
}

async function setupBranch(
  sandboxManager: SandboxManager,
  sandboxId: string,
  branchName: string,
): Promise<string> {
  await sandboxManager.runCommand({
    sandboxId,
    command: "git",
    args: ["fetch", "--all"],
  });

  const branchResult = await sandboxManager.runCommand({
    sandboxId,
    command: "git",
    args: ["branch", "-a"],
  });

  const branches = branchResult.stdout;
  const defaultBranch = branches.includes("origin/main")
    ? "main"
    : branches.includes("origin/master")
      ? "master"
      : "main";

  const targetBranch = branches.includes(`origin/${branchName}`)
    ? `origin/${branchName}`
    : branches.includes(branchName)
      ? branchName
      : branchName;

  const switchResult = await sandboxManager.runCommand({
    sandboxId,
    command: "git",
    args: ["switch", targetBranch],
  });

  if (switchResult.stderr && !switchResult.stderr.includes("Switched")) {
    return defaultBranch;
  }

  return defaultBranch;
}

export async function runReviewAgent(
  branchName: string,
  options: ReviewAgentOptions,
): Promise<ReviewResult> {
  const { sandboxManager, sandboxId } = options;

  const cwdResult = await sandboxManager.runCommand({
    sandboxId,
    command: "pwd",
  });
  const workingDir = cwdResult.stdout.trim() || "/home/user";

  const defaultBranch = await setupBranch(
    sandboxManager,
    sandboxId,
    branchName,
  );

  const tools = {
    ls: createLsTool(sandboxManager, sandboxId),
    grep: createGrepTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    git: createGitTool(sandboxManager, sandboxId),
  };

  const systemPrompt = `${REVIEW_AGENT_SYSTEM_PROMPT}
  
Current working directory: ${workingDir}
Default branch (base for comparison): ${defaultBranch}
Target branch (to review): ${branchName}

IMPORTANT: Before reviewing, run 'git diff ${defaultBranch}..HEAD' to see what changed in this branch compared to the default branch.`;

  const generation = await generateText({
    model: options.model,
    system: systemPrompt,
    prompt: buildReviewPrompt(branchName, workingDir),
    tools,
    toolChoice: "required",
    stopWhen: stepCountIs(options.maxToolSteps ?? 15),
    abortSignal: options.signal,
    experimental_onToolCallFinish: (toolCall) => {
      console.log(
        `[tool call ${toolCall.stepNumber}] ${toolCall.toolCall.toolName}(${JSON.stringify(
          toolCall.toolCall.input,
        )})`,
      );
      console.log(`[tool result] ${toolCall.output}`);
    },
    onStepFinish: (step) => {
      console.log(
        `[step ${step.stepNumber}] finish=${JSON.stringify(step.finishReason)} toolCalls=${step.toolCalls.length}`,
      );
    },
  });

  return parseJsonResponse(generation.text);
}

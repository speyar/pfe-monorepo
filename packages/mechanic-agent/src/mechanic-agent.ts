import { generateText, stepCountIs, type LanguageModel } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { fixResultSchema } from "./schema/fix-result";
import type { FixResult, ChangedFile } from "./schema/fix-result";
import { MECHANIC_AGENT_SYSTEM_PROMPT } from "./prompts/mechanic-agent";
import { createLsTool } from "./tools/LsTool";
import { createGlobTool } from "./tools/GlobTool";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGrepTool } from "./tools/GrepTool";
import { createGitTool } from "./tools/GitTool";
import { createCodebaseGraphTool } from "./tools/CodebaseGraphTool";
import { createWriteFileTool } from "./tools/WriteFileTool";
import { createEditFileTool } from "./tools/EditFileTool";
import { createRunCommandTool } from "./tools/RunCommandTool";

export interface MechanicAgentOptions {
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  sentryContextPrompt: string;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  graphPath?: string;
  workingDir?: string;
}

export { type FixResult, type ChangedFile } from "./schema/fix-result";

async function runCommand(
  sandboxManager: SandboxManager,
  sandboxId: string,
  command: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await sandboxManager.runCommand({
      sandboxId,
      command,
      args,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: message, exitCode: 127 };
  }
}

function parseJsonResponse(text: string): FixResult | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return null;

  function tryParse(raw: string): unknown {
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  function fixJson(raw: string): string {
    return raw
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/'/g, '"')
      .replace(/(\w+):/g, '"$1":')
      .replace(/\/\/.*$/gm, "");
  }

  let parsed: unknown = tryParse(cleaned);
  if (parsed === undefined) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = tryParse(match[0]) ?? tryParse(fixJson(match[0]));
    }
  }
  if (parsed === undefined) return null;

  const result = fixResultSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function runMechanicAgent(
  options: MechanicAgentOptions,
): Promise<FixResult> {
  const { sandboxManager, sandboxId } = options;

  const cwdResult = await sandboxManager.runCommand({
    sandboxId,
    command: "pwd",
  });
  const workingDir = options.workingDir ?? (cwdResult.stdout.trim() || "/home/user");

  const tools = {
    ls: createLsTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    grep: createGrepTool(sandboxManager, sandboxId),
    git: createGitTool(sandboxManager, sandboxId),
    writeFile: createWriteFileTool(sandboxManager, sandboxId),
    editFile: createEditFileTool(sandboxManager, sandboxId),
    runCommand: createRunCommandTool(sandboxManager, sandboxId),
    ...(options.graphPath
      ? {
          codebaseGraph: createCodebaseGraphTool(
            sandboxManager,
            sandboxId,
            options.graphPath,
          ),
        }
      : {}),
  };

  const maxSteps = options.maxToolSteps ?? 20;
  const minToolSteps = Math.max(
    3,
    Math.min(options.minToolSteps ?? 5, maxSteps),
  );

  let graphContextInfo = "";
  if (options.graphPath) {
    try {
      const graphResult = await runCommand(sandboxManager, sandboxId, "cat", [
        options.graphPath,
      ]);
      if (graphResult.exitCode === 0 && graphResult.stdout) {
        const graphData = JSON.parse(graphResult.stdout);
        const nodeCount = graphData.metadata?.nodeCount ?? 0;
        const edgeCount = graphData.metadata?.edgeCount ?? 0;
        const fileCount = graphData.metadata?.fileCount ?? 0;

        graphContextInfo = `
CODEBASE GRAPH TOOL AVAILABLE:
A codebaseGraph tool is available with precomputed dependency graph data.
Graph stats: ${fileCount} files, ${nodeCount} nodes, ${edgeCount} edges.

Use codebaseGraph for structural queries (findCallersOf, findImpactOf, etc.).`;
      }
    } catch {
      // graph not available, skip
    }
  }

  const systemPrompt = `${MECHANIC_AGENT_SYSTEM_PROMPT}

Current working directory: ${workingDir}

IMPORTANT SAFETY RULES:
- Only fix the specific bug described in the Sentry error
- Make minimal, targeted changes
- Always run lint/typecheck after making changes
- If a verification command fails, try to fix the issue and re-verify (up to 3 attempts)
- Do NOT make changes outside the scope of the bug fix
${graphContextInfo}`;

  const forceFinalizeStep = Math.max(minToolSteps + 1, maxSteps - 3);

  const jsonSchemaHint = [
    'Return ONLY valid JSON matching this schema and nothing else:',
    '{"summary": "...", "rootCause": "...", "verificationPassed": true/false, "verificationNotes": "...", "filesChanged": [{"path": "...", "description": "..."}], "confident": true/false}',
  ].join("\n");

  const generation = await generateText({
    model: options.model,
    system: systemPrompt,
    prompt: options.sentryContextPrompt,
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: options.signal,
    prepareStep: ({ stepNumber }) => {
      if (stepNumber >= forceFinalizeStep) {
        return {
          toolChoice: "none",
          activeTools: [],
          system: `${systemPrompt}\n\nYou must now output ONLY valid JSON with NO surrounding text or markdown fences.\n${jsonSchemaHint}`,
        };
      }
      return undefined;
    },
    onStepFinish: (step) => {
      console.log(
        `[mechanic-agent] step ${step.stepNumber} finish=${step.finishReason} toolCalls=${step.toolCalls.length}`,
      );
    },
  });

  console.log("[mechanic-agent] fix generation completed");

  let finalText = "";
  for (const step of generation.steps) {
    if (step.text) finalText += step.text;
  }
  finalText = finalText || generation.text || "";

  const parsed = parseJsonResponse(finalText);
  return parsed ?? {
    summary: "Agent failed to produce a valid fix result.",
    rootCause: "Unable to parse LLM output.",
    verificationPassed: false,
    filesChanged: [],
    confident: false,
  };
}

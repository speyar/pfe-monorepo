import { generateText, stepCountIs, type LanguageModel, type Tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import {
  reviewFindingSchema,
  subAgentResultSchema,
} from "../schema/review-result";
import type { SubAgentResult } from "../schema/review-result";
import {
  buildSubAgentSystemPrompt,
  type SharedContext,
} from "../orchestrator/shared-context";

function parseJsonResponseWithReason(text: string): {
  output: SubAgentResult | null;
  reason: string;
} {
  const cleaned = text.trim();
  if (!cleaned) {
    return { output: null, reason: "empty-text" };
  }

  function tryParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  function fixJson(raw: string): string {
    return raw
      .replace(/,\s*([}\]])/g, "$1") // trailing commas
      .replace(/'/g, '"') // single quotes
      .replace(/(\w+):/g, '"$1":') // unquoted keys
      .replace(/\/\/.*$/gm, ""); // line comments
  }

  let parsed: unknown;

  // Strategy 1: direct parse
  parsed = tryParse(cleaned);

  // Strategy 2: extract {...} via regex
  if (parsed === undefined) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = tryParse(match[0]) ?? tryParse(fixJson(match[0]));
    }
  }

  if (parsed === undefined) {
    return { output: null, reason: "no-json-object-found" };
  }

  const obj = parsed as Record<string, unknown>;
  const rawFindings = Array.isArray(obj?.findings) ? obj.findings : [];

  if (rawFindings.length === 0) {
    return { output: { findings: [] }, reason: "empty-findings" };
  }

  const valid = rawFindings
    .map((f: unknown) => reviewFindingSchema.safeParse(f))
    .filter((r): r is { success: true; data: SubAgentResult["findings"][number] } => r.success)
    .map((r) => r.data);

  const dropped = rawFindings.length - valid.length;
  if (dropped > 0) {
    console.log(
      `[parseJson] dropped ${dropped}/${rawFindings.length} invalid findings`,
    );
  }

  return {
    output: { findings: valid },
    reason: valid.length > 0 ? "ok" : "all-findings-invalid",
  };
}

export interface RunSubAgentInput {
  agentId: string;
  agentPrompt: string;
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  sharedContext: SharedContext;
  tools: Record<string, Tool>;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface RunSubAgentOutput {
  agentId: string;
  findings: SubAgentResult["findings"];
  summary: string;
}

async function generateWithFallback(input: {
  model: LanguageModel;
  system: string;
  prompt: string;
  tools: Record<string, Tool>;
  maxSteps: number;
  signal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}): Promise<{ output: SubAgentResult | null; text: string }> {
  try {
    let fallbackToolStepCount = 0;

    const generation = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      tools: input.tools,
      stopWhen: stepCountIs(input.maxSteps),
      abortSignal: input.signal,
      providerOptions: input.providerOptions as any,
      onStepFinish: (step) => {
        if (step.toolCalls.length > 0) {
          fallbackToolStepCount += 1;
        }
        const toolNames =
          step.toolCalls.map((toolCall) => toolCall.toolName).join(",") || "-";
        console.log(
          `[fallback:step ${step.stepNumber}] finish=${JSON.stringify(step.finishReason)} rawFinish=${JSON.stringify(step.rawFinishReason)} toolCalls=${step.toolCalls.length} toolNames=${toolNames} toolSteps=${fallbackToolStepCount} textLen=${(step.text ?? "").length}`,
        );
      },
    });

    const text = generation.text ?? "";
    const parsed = parseJsonResponseWithReason(text);
    const output = parsed.output;

    const textPreview = text.length > 200 ? text.slice(0, 200) + "..." : text;
    console.log(
      `[generateWithFallback] done steps=${generation.steps.length} finish=${JSON.stringify(generation.finishReason)} rawFinish=${JSON.stringify(generation.rawFinishReason)} warnings=${generation.warnings?.length ?? 0} textLen=${text.length} parseReason=${parsed.reason} preview=${JSON.stringify(textPreview)}`,
    );

    return { output, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const name =
      typeof error === "object" && error !== null && "name" in error
        ? String((error as { name?: unknown }).name)
        : "UnknownError";
    console.log(
      `[generateWithFallback] fallback generation failed: ${name}: ${message}`,
    );
    return { output: null, text: "" };
  }
}

export async function runSubAgent(
  input: RunSubAgentInput,
): Promise<RunSubAgentOutput> {
  const systemPrompt = buildSubAgentSystemPrompt({
    agentPrompt: input.agentPrompt,
    sharedContext: input.sharedContext,
  });

  const maxSteps = input.maxToolSteps ?? 20;
  const minToolSteps = Math.max(
    2,
    Math.min(input.minToolSteps ?? 4, Math.max(2, maxSteps - 3)),
  );
  const forceFinalizeStep = Math.max(minToolSteps + 1, maxSteps - 2);

  const userPrompt = [
    `You are the ${input.agentId} reviewer. Review the changes in this PR for issues in your domain.`,
    "",
    "The PRECOMPUTED DIFF is in the system prompt above. Study it first, then use tools for deeper investigation.",
    `You have at most ${maxSteps} steps. You MUST use at least ${minToolSteps} tool-using steps before returning JSON.`,
    `Do not stop calling tools until you have inspected at least 5 files. By step ${forceFinalizeStep}, stop calling tools and return final JSON.`,
    'Return only JSON with shape {"findings": [...]} and no surrounding prose.',
    "IMPORTANT: You are expected to find real issues. If you find none, you failed your job.",
  ].join("\n");

  let toolStepCount = 0;
  let finalText = "";

  try {
    const generation = await generateText({
      model: input.model,
      system: systemPrompt,
      prompt: userPrompt,
      tools: input.tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal: input.signal,
      providerOptions: input.providerOptions as any,
      prepareStep: ({ stepNumber }) => {
        if (stepNumber >= forceFinalizeStep) {
          return {
            toolChoice: "none",
            activeTools: [],
          };
        }
        return undefined;
      },
      onStepFinish: (step) => {
        if (step.toolCalls.length > 0) {
          toolStepCount += 1;
        }
        if (step.text) {
          finalText = step.text;
        }
        const toolNames =
          step.toolCalls.map((toolCall) => toolCall.toolName).join(",") || "-";
        console.log(
          `[${input.agentId}:step ${step.stepNumber}] finish=${JSON.stringify(step.finishReason)} rawFinish=${JSON.stringify(step.rawFinishReason)} toolCalls=${step.toolCalls.length} toolNames=${toolNames} toolSteps=${toolStepCount}/${minToolSteps} textLen=${(step.text ?? "").length}`,
        );
      },
    });

    const text = finalText || generation.text || "";
    const parsed = parseJsonResponseWithReason(text);
    const parsedOutput = parsed.output;

    console.log(
      `[${input.agentId}] primary done — steps=${generation.steps.length} finish=${JSON.stringify(generation.finishReason)} rawFinish=${JSON.stringify(generation.rawFinishReason)} warnings=${generation.warnings?.length ?? 0} toolSteps=${toolStepCount}/${minToolSteps} textLen=${text.length} parseReason=${parsed.reason} textPreview=${JSON.stringify(text.length > 300 ? text.slice(0, 300) + "..." : text)}`,
    );

    if (parsedOutput && Array.isArray(parsedOutput.findings)) {
      console.log(
        `[${input.agentId}] completed — ${parsedOutput.findings.length} findings`,
      );
      return {
        agentId: input.agentId,
        findings: parsedOutput.findings,
        summary: `${input.agentId} review found ${parsedOutput.findings.length} issues.`,
      };
    }

    console.log(
      `[${input.agentId}] primary output not parsable, trying fallback generation`,
    );

    const fallback = await generateWithFallback({
      model: input.model,
      system: systemPrompt,
      prompt: `${userPrompt}\n\nDo not call tools. Return only strict JSON now.`,
      tools: {},
      maxSteps: Math.min(maxSteps, 8),
      signal: input.signal,
      providerOptions: input.providerOptions,
    });

    if (fallback.output && Array.isArray(fallback.output.findings)) {
      console.log(
        `[${input.agentId}] fallback completed — ${fallback.output.findings.length} findings`,
      );
      return {
        agentId: input.agentId,
        findings: fallback.output.findings,
        summary: `${input.agentId} review found ${fallback.output.findings.length} issues (fallback mode).`,
      };
    }

    return {
      agentId: input.agentId,
      findings: [],
      summary: `${input.agentId} review completed but returned no structured findings.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${input.agentId}] failed`, { error: message });

    const fallback = await generateWithFallback({
      model: input.model,
      system: systemPrompt,
      prompt: `${userPrompt}\n\nDo not call tools. Return only strict JSON now.`,
      tools: {},
      maxSteps: Math.min(maxSteps, 8),
      signal: input.signal,
      providerOptions: input.providerOptions,
    });

    if (fallback.output && Array.isArray(fallback.output.findings)) {
      console.log(
        `[${input.agentId}] fallback completed after error — ${fallback.output.findings.length} findings`,
      );
      return {
        agentId: input.agentId,
        findings: fallback.output.findings,
        summary: `${input.agentId} review found ${fallback.output.findings.length} issues (fallback mode).`,
      };
    }

    return {
      agentId: input.agentId,
      findings: [],
      summary: `${input.agentId} review encountered an error: ${message}`,
    };
  }
}

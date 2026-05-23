import { generateText, type LanguageModel, type Tool } from "ai";
import { orchestratorResultSchema } from "../schema/review-result";
import type { OrchestratorResult } from "../schema/review-result";
import type { RunSubAgentOutput } from "../sub-agents/base";
import type { SharedContext } from "./shared-context";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator-prompt";

function truncateText(value: string | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function parseOrchestratorJsonWithReason(text: string): {
  output: OrchestratorResult | null;
  reason: string;
} {
  const cleaned = text.trim();
  if (!cleaned) {
    return { output: null, reason: "empty-text" };
  }

  const withoutFences = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = withoutFences.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { output: null, reason: "no-json-object-found" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validated = orchestratorResultSchema.safeParse(parsed);
    if (!validated.success) {
      const firstIssue = validated.error.issues[0];
      return {
        output: null,
        reason: `schema-parse-failed:${firstIssue?.path.join(".") ?? "unknown"}:${firstIssue?.message ?? "invalid"}`,
      };
    }

    return { output: validated.data, reason: "ok" };
  } catch (jsonError) {
    const message =
      jsonError instanceof Error ? jsonError.message : String(jsonError);
    return {
      output: null,
      reason: `json-parse-failed:${message.split("\n")[0]}`,
    };
  }
}

function deterministicDeduplicate(
  results: RunSubAgentOutput[],
): RunSubAgentOutput[] {
  const seen = new Map<string, number>();

  return results.map((result) => {
    const dedupedFindings = result.findings.filter((finding) => {
      const key = JSON.stringify({
        file: finding.file,
        line: finding.line,
        quote: finding.quote,
      });
      const existingIndex = seen.get(key);
      if (existingIndex !== undefined) {
        return false;
      }
      seen.set(key, result.findings.indexOf(finding));
      return true;
    });

    return {
      ...result,
      findings: dedupedFindings,
    };
  });
}

function buildOrchestratorPrompt(input: {
  results: RunSubAgentOutput[];
  sharedContext: SharedContext;
}): string {
  const agentsText = input.results
    .map((result) => {
      const findingsText = result.findings
        .map(
          (finding) => `- [${finding.severity}] ${finding.file}${
            finding.line ? `:${finding.line}` : ""
          }: ${finding.title}
  Message: ${truncateText(finding.message, 600)}
  Quote: ${truncateText(finding.quote, 200)}
  Suggestion: ${truncateText(finding.suggestion, 400)}`,
        )
        .join("\n");

      return [
        `### ${result.agentId}`,
        `Summary: ${result.summary}`,
        `Total: ${result.findings.length} findings`,
        findingsText || "(no findings)",
      ].join("\n");
    })
    .join("\n\n");

  const diffSummaryText = input.sharedContext.diffSummary
    ? JSON.stringify(input.sharedContext.diffSummary)
    : "(none)";

  return [
    `Changed files (${input.sharedContext.changedFiles.length}):`,
    input.sharedContext.changedFiles.join("\n"),
    "",
    "Diff summary:",
    diffSummaryText,
    "",
    "Sub-agent results (ALL findings, NOT truncated):",
    agentsText,
    "",
    "Refine these findings. Merge duplicates, fix severities, improve messages.",
    "Add cross-cutting findings if you see higher-order issues across agents.",
    'Return ONLY JSON object with keys "findings" and "agentSummaries".',
    "Do not return markdown or code fences.",
  ].join("\n");
}

export async function runOrchestrator(input: {
  model: LanguageModel;
  results: RunSubAgentOutput[];
  sharedContext: SharedContext;
  tools: Record<string, Tool>;
  signal?: AbortSignal;
}): Promise<OrchestratorResult> {
  const dedupedResults = deterministicDeduplicate(input.results);

  const totalFindings = dedupedResults.reduce(
    (sum, r) => sum + r.findings.length,
    0,
  );

  if (totalFindings === 0) {
    console.log(
      "[orchestrator] no findings from any sub-agent, skipping LLM merge",
    );
    return {
      findings: [],
      agentSummaries: dedupedResults.map((r) => ({
        agentId: r.agentId,
        summary: r.summary,
      })),
    };
  }

  const hasTools = input.tools && Object.keys(input.tools).length > 0;

  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    try {
      const basePrompt = buildOrchestratorPrompt({
        results: dedupedResults,
        sharedContext: input.sharedContext,
      });

      const attemptPrompts = [
        basePrompt,
        [
          basePrompt,
          "",
          "Your previous attempt failed to parse. Return ONLY valid JSON.",
          'JSON shape: {"findings":[...],"agentSummaries":[{"agentId":"...","summary":"..."}]}',
        ].join("\n"),
        [
          basePrompt,
          "",
          "CRITICAL: Your output MUST be parseable JSON.",
          "No markdown fences. No trailing commas. No comments.",
          "Use strict JSON only.",
          '{"findings":[],"agentSummaries":[]}',
        ].join("\n"),
      ];

      console.log(
        `[orchestrator] attempt ${attemptIndex + 1}/3 running LLM merge on ${totalFindings} findings from ${dedupedResults.length} agents${hasTools ? " (with tools)" : " (no tools)"}`,
      );

      const genOpts: Record<string, unknown> = {
        model: input.model,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        prompt: attemptPrompts[attemptIndex] ?? basePrompt,
        abortSignal: input.signal,
      };
      if (hasTools) {
        genOpts.tools = input.tools;
        genOpts.maxSteps = 10;
      }
      const generation = await (generateText as any)(genOpts);

      const text = generation.text ?? "";
      const parsed = parseOrchestratorJsonWithReason(text);
      const preview = text.length > 280 ? `${text.slice(0, 280)}...` : text;

      console.log(
        `[orchestrator] attempt=${attemptIndex + 1}/3 done steps=${generation.steps.length} finish=${JSON.stringify(generation.finishReason)} rawFinish=${JSON.stringify(generation.rawFinishReason)} warnings=${generation.warnings?.length ?? 0} textLen=${text.length} parseReason=${parsed.reason} preview=${JSON.stringify(preview)}`,
      );

      if (parsed.output) {
        console.log(
          `[orchestrator] merge complete — ${parsed.output.findings.length} findings after dedup (attempt ${attemptIndex + 1})`,
        );
        return parsed.output;
      }
    } catch (attemptError) {
      const errorName =
        typeof attemptError === "object" &&
        attemptError !== null &&
        "name" in attemptError
          ? String((attemptError as { name?: unknown }).name)
          : "UnknownError";
      const errorMessage =
        attemptError instanceof Error
          ? attemptError.message
          : String(attemptError);

      console.warn("[orchestrator] LLM merge attempt failed", {
        attempt: attemptIndex + 1,
        errorName,
        errorMessage,
      });
    }
  }

  console.log(
    "[orchestrator] LLM merge returned non-parseable JSON after 3 attempts, using deterministic fallback",
  );

  const allFindings = dedupedResults.flatMap((r) => r.findings);
  allFindings.sort((a, b) => {
    const severityOrder: Record<string, number> = {
      P0: 0,
      P1: 1,
      P2: 2,
      P3: 3,
      P4: 4,
    };
    return (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
  });

  return {
    findings: allFindings,
    agentSummaries: dedupedResults.map((r) => ({
      agentId: r.agentId,
      summary: r.summary,
    })),
  };
}

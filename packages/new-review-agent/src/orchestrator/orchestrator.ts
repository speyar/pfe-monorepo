import { streamText, type LanguageModel } from "ai";
import { reviewResultSchema } from "../schema/review-result";
import type { OrchestratorResult } from "../schema/review-result";
import type { RunSubAgentOutput } from "../sub-agents/base";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator-prompt";
import { addUsageTelemetry } from "../telemetry/usage-telemetry";

function truncateText(value: string | undefined, maxLength: number): string {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function parseFindingsJson(text: string): {
  findings: import("../schema/review-result").ReviewFinding[] | null;
  reason: string;
} {
  const cleaned = text.trim();
  if (!cleaned) return { findings: null, reason: "empty-text" };

  const withoutFences = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = withoutFences.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { findings: null, reason: "no-json-object-found" };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validated = reviewResultSchema.safeParse(parsed);
    if (!validated.success) {
      const firstIssue = validated.error.issues[0];
      return {
        findings: null,
        reason: `schema-parse-failed:${firstIssue?.path.join(".") ?? "unknown"}:${firstIssue?.message ?? "invalid"}`,
      };
    }
    return { findings: validated.data.findings, reason: "ok" };
  } catch (jsonError) {
    const message = jsonError instanceof Error ? jsonError.message : String(jsonError);
    return { findings: null, reason: `json-parse-failed:${message.split("\n")[0]}` };
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
      if (existingIndex !== undefined) return false;
      seen.set(key, result.findings.indexOf(finding));
      return true;
    });

    return { ...result, findings: dedupedFindings };
  });
}

function buildOrchestratorPrompt(results: RunSubAgentOutput[]): string {
  const agentsText = results
    .map((result) => {
      const findingsText = result.findings
        .map(
          (finding) =>
            `- [${finding.severity}] ${finding.file}${finding.line ? `:${finding.line}` : ""}: ${finding.title}
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

  return [
    "Sub-agent findings:",
    agentsText,
    "",
    "Merge findings that describe the EXACT SAME issue (same file, same root cause).",
    "Sort by severity (P0 first).",
    "Preserve ALL original text exactly — do NOT rewrite, reformat, or improve anything.",
    'Return ONLY JSON object with a single "findings" key.',
    "No markdown, no code fences.",
  ].join("\n");
}

export async function runOrchestrator(input: {
  model: LanguageModel;
  results: RunSubAgentOutput[];
  signal?: AbortSignal;
}): Promise<OrchestratorResult> {
  const dedupedResults = deterministicDeduplicate(input.results);

  const totalFindings = dedupedResults.reduce((sum, r) => sum + r.findings.length, 0);

  if (totalFindings === 0) {
    console.log("[orchestrator] no findings from any sub-agent, skipping LLM merge");
    return {
      findings: [],
      agentSummaries: dedupedResults.map((r) => ({ agentId: r.agentId, summary: r.summary })),
    };
  }

  const attemptStart = Date.now();
  const prompt = buildOrchestratorPrompt(dedupedResults);
  const modelLabel = (input.model as { modelId?: string }).modelId ?? "unknown";

  console.log(
    `[orchestrator] calling ${modelLabel} — prompt=${prompt.length}chars ${totalFindings}findings from ${dedupedResults.length}agents`,
  );

  try {
    const streamResp = streamText({
      model: input.model,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      prompt,
      abortSignal: input.signal,
    });

    let fullText = "";
    let chunkCount = 0;
    const firstTokenWait = Date.now();
    let ttfbMs = 0;

    for await (const chunk of streamResp.textStream) {
      if (chunkCount === 0) {
        ttfbMs = Date.now() - firstTokenWait;
        console.log(`[orchestrator] first token after ${ttfbMs}ms`);
      }
      fullText += chunk;
      chunkCount++;
    }

    const totalMs = Date.now() - attemptStart;
    const usage = await streamResp.usage;
    const finishReason = await streamResp.finishReason;
    addUsageTelemetry(usage);

    console.log(
      `[orchestrator] stream done — ${totalMs}ms ttfb=${ttfbMs}ms chunks=${chunkCount} textLen=${fullText.length} finish=${JSON.stringify(finishReason)}`,
    );

    if (fullText.length > 0 && chunkCount > 0) {
      const preview = fullText.length > 500 ? fullText.slice(0, 500) + "..." : fullText;
      console.log(`[orchestrator] raw text preview:\n${preview}`);
    }

    const parsed = parseFindingsJson(fullText);
    console.log(`[orchestrator] parseResult=${parsed.reason}`);

    if (parsed.findings) {
      console.log(`[orchestrator] merge complete — ${parsed.findings.length} findings (${totalMs}ms)`);
      return {
        findings: parsed.findings,
        agentSummaries: dedupedResults.map((r) => ({ agentId: r.agentId, summary: r.summary })),
      };
    }

    console.warn("[orchestrator] LLM output not parseable, using deterministic fallback");
  } catch (error) {
    const elapsed = Date.now() - attemptStart;
    console.warn(
      `[orchestrator] LLM merge failed after ${elapsed}ms, using deterministic fallback`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  const allFindings = dedupedResults.flatMap((r) => r.findings);
  allFindings.sort((a, b) => {
    const severityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
    return (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
  });

  return {
    findings: allFindings,
    agentSummaries: dedupedResults.map((r) => ({ agentId: r.agentId, summary: r.summary })),
  };
}

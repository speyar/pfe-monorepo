import { generateText, type LanguageModel } from "ai";
import type { OrchestratorResult } from "../schema/review-result";
import type { RunSubAgentOutput } from "../sub-agents/base";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrator-prompt";
import { addUsageTelemetry } from "../telemetry/usage-telemetry";

interface MergeDecision {
  keep: string;
  dupes: string[];
}

interface OrchestratorDecisions {
  merges: MergeDecision[];
  removals: string[];
}

function parseDecisionsJson(text: string): OrchestratorDecisions | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const merges: MergeDecision[] = [];
    if (Array.isArray(parsed.merges)) {
      for (const merge of parsed.merges) {
        if (
          merge &&
          typeof merge.keep === "string" &&
          Array.isArray(merge.dupes)
        ) {
          merges.push({
            keep: merge.keep,
            dupes: merge.dupes.filter(
              (d: unknown) => typeof d === "string",
            ),
          });
        }
      }
    }
    const removals: string[] = [];
    if (Array.isArray(parsed.removals)) {
      for (const r of parsed.removals) {
        if (typeof r === "string") removals.push(r);
      }
    }
    return { merges, removals };
  } catch {
    return null;
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

function truncateForPrompt(
  value: string | undefined,
  maxLength: number,
): string {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function buildDecisionPrompt(findingsList: string): string {
  return [
    "Findings to review:",
    "",
    findingsList,
    "",
    "Which findings describe the EXACT SAME issue (same file, same root cause)?",
    "",
    'Return ONLY this JSON (no markdown, no fences):',
    '{ "merges": [{ "keep": "<id>", "dupes": ["<id>", ...] }], "removals": ["<id>", ...] }',
    "",
    '- merges: group duplicate findings. "keep" = preserve this one, "dupes" = drop these.',
    "- removals: drop these findings as wrong or not actionable.",
    '- If no merges/removals needed: { "merges": [], "removals": [] }',
    "- Only merge findings about the EXACT SAME root cause, not just the same file.",
    "- When in doubt, do NOT merge. Keeping separate findings is always safe.",
  ].join("\n");
}

type SeverityLevel = "P0" | "P1" | "P2" | "P3" | "P4";

interface FindingWithId {
  id: string;
  severity: SeverityLevel;
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

export async function runOrchestrator(input: {
  model: LanguageModel;
  results: RunSubAgentOutput[];
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

  const allFindings: FindingWithId[] = [];
  let idCounter = 0;
  for (const result of dedupedResults) {
    for (const finding of result.findings) {
      allFindings.push({
        id: `f${idCounter}`,
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
        quote: finding.quote,
        title: finding.title,
        message: finding.message,
        suggestion: finding.suggestion,
      });
      idCounter++;
    }
  }

  const findingsById = new Map(allFindings.map((f) => [f.id, f]));

  const findingsList = allFindings
    .map((f) => {
      const location = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ""}`
        : "unknown";
      const msg = truncateForPrompt(f.message, 200);
      const quote = f.quote
        ? `\n     quote: ${truncateForPrompt(f.quote, 100)}`
        : "";
      return `[${f.id}] [${f.severity}] ${location} \u2014 ${f.title}\n     ${msg}${quote}`;
    })
    .join("\n\n");

  const prompt = buildDecisionPrompt(findingsList);
  const attemptStart = Date.now();
  const modelLabel =
    (input.model as { modelId?: string }).modelId ?? "unknown";

  console.log(
    `[orchestrator] calling ${modelLabel} \u2014 ${allFindings.length} findings from ${dedupedResults.length} agents (decision mode, prompt=${prompt.length}chars)`,
  );

  try {
    const result = await generateText({
      model: input.model,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      prompt,
      abortSignal: input.signal,
    });
    addUsageTelemetry(result.usage as unknown);

    const totalMs = Date.now() - attemptStart;
    const resultText = result.text ?? "";
    console.log(
      `[orchestrator] decision done \u2014 ${totalMs}ms textLen=${resultText.length}`,
    );

    const decisions = parseDecisionsJson(resultText);
    if (decisions) {
      const mergedIds = new Set<string>();
      const removedIds = new Set<string>();

      for (const removal of decisions.removals) {
        if (findingsById.has(removal)) {
          removedIds.add(removal);
        }
      }

      for (const merge of decisions.merges) {
        if (!findingsById.has(merge.keep)) continue;
        for (const dupeId of merge.dupes) {
          if (findingsById.has(dupeId)) {
            mergedIds.add(dupeId);
          }
        }
      }

      const finalFindings = allFindings
        .filter((f) => !mergedIds.has(f.id) && !removedIds.has(f.id))
        .map(({ severity, file, line, quote, title, message, suggestion }) => ({
          severity,
          file,
          line,
          quote,
          title,
          message,
          suggestion,
        }));

      finalFindings.sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 5) -
          (SEVERITY_ORDER[b.severity] ?? 5),
      );

      console.log(
        `[orchestrator] merge complete \u2014 ${finalFindings.length} findings (${decisions.merges.length} merges, ${decisions.removals.length} removals, ${totalMs}ms)`,
      );

      return {
        findings: finalFindings,
        agentSummaries: dedupedResults.map((r) => ({
          agentId: r.agentId,
          summary: r.summary,
        })),
      };
    }

    console.warn(
      "[orchestrator] could not parse decisions, using deterministic sort",
    );
  } catch (error) {
    const elapsed = Date.now() - attemptStart;
    console.warn(
      `[orchestrator] LLM failed after ${elapsed}ms, using deterministic sort`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  const allFindingsSorted = [...allFindings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5),
  );

  return {
    findings: allFindingsSorted.map(
      ({ severity, file, line, quote, title, message, suggestion }) => ({
        severity,
        file,
        line,
        quote,
        title,
        message,
        suggestion,
      }),
    ),
    agentSummaries: dedupedResults.map((r) => ({
      agentId: r.agentId,
      summary: r.summary,
    })),
  };
}
import { generateText, type LanguageModel } from "ai";
import type { ReviewFinding } from "./schema/review-result";
import type { DependencyMap, V2ReviewFinding } from "./v2/types";
import { verifyAndDedupeFindings, crossRefDedupe } from "./v2/finding-verifier";

export interface CrossRefInput {
  model: LanguageModel;
  subFindings: ReviewFinding[];
  dependencyMap?: DependencyMap;
  totalChangedFiles: number;
  totalBatches: number;
}

export interface CrossRefResult {
  findings: ReviewFinding[];
  dedupCount: number;
  missedCount: number;
  contradictoryPairs: Array<{ a: string; b: string }>;
}

function buildCrossRefPrompt(input: CrossRefInput): string {
  const depContext = input.dependencyMap
    ? [
        "DEPENDENCY MAP:",
        ...input.dependencyMap.summary,
        "",
        `Hot files: ${input.dependencyMap.hotFiles.join(", ") || "none"}`,
        `Top symbols: ${input.dependencyMap.topSymbols.slice(0, 10).join(", ") || "none"}`,
        "",
        "Dependency graph edges:",
        ...input.dependencyMap.edges.slice(0, 30).map(
          (e) => `  ${e.from} → ${e.to} [${e.kind}]`,
        ),
        "",
      ].join("\n")
    : `NO DEPENDENCY MAP AVAILABLE. Cross-reference manually.\n\n`;

  const findingsList = input.subFindings
    .map((f, i) => {
      const loc = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ""}`
        : "unknown";
      return `  ${i + 1}. [${f.severity}] ${loc} — ${f.title}\n     ${(f.message ?? "").slice(0, 150)}`;
    })
    .join("\n");

  return [
    `You are a cross-reference review agent analyzing findings from ${input.totalBatches} sub-agent batches.`,
    "",
    `PR scope: ${input.totalChangedFiles} files changed across ${input.totalBatches} batches.`,
    "",
    depContext,
    "",
    `SUB-AGENT FINDINGS (${input.subFindings.length} total):`,
    findingsList,
    "",
    "YOUR TASKS:",
    "",
    "1. DEDUPLICATE: Identify findings that report the same issue. Merge them, keeping the highest severity.",
    "",
    "2. CROSS-REFERENCE: For each finding, check if it impacts files in OTHER batches.",
    "   A changed function in batch A might break a caller that was in batch B.",
    "   If a finding affects cross-batch code, note which other files are affected.",
    "",
    "3. FIND CONTRADICTIONS: Does one finding say X is broken while another finding implicitly assumes X works?",
    "   Report contradictory pairs.",
    "",
    "4. IDENTIFY MISSED ISSUES: Look at the dependency map — are there changed files or symbols that",
    "   NO sub-agent reported on? Flag these as potentially missed.",
    "",
    "5. PRODUCE FINAL FINDINGS: Output a consolidated, deduplicated set with adjusted severities.",
    "",
    "OUTPUT FORMAT — JSON only:",
    '{',
    '  "findings": [...],',
    '  "dedupCount": 3,',
    '  "missedIssues": ["file X has high churn but 0 findings", "symbol Y was changed but never checked"],',
    '  "contradictoryPairs": [{"a": "finding 3 says X broke", "b": "finding 7 assumes X works"}]',
    '}',
  ].join("\n");
}

function parseCrossRefResponse(
  text: string,
): {
  findings: ReviewFinding[];
  dedupCount: number;
  missedIssues: string[];
  contradictoryPairs: Array<{ a: string; b: string }>;
} {
  const cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { findings: [], dedupCount: 0, missedIssues: [], contradictoryPairs: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      dedupCount: typeof parsed.dedupCount === "number" ? parsed.dedupCount : 0,
      missedIssues: Array.isArray(parsed.missedIssues)
        ? parsed.missedIssues
        : [],
      contradictoryPairs: Array.isArray(parsed.contradictoryPairs)
        ? parsed.contradictoryPairs
        : [],
    };
  } catch {
    return { findings: [], dedupCount: 0, missedIssues: [], contradictoryPairs: [] };
  }
}

export async function runCrossReference(
  input: CrossRefInput,
): Promise<CrossRefResult> {
  console.log(
    `[cross-ref] Starting — ${input.subFindings.length} findings from ${input.totalBatches} batches, ${input.totalChangedFiles} total files`,
  );

  const startedAt = Date.now();

  const findingsForV2: V2ReviewFinding[] = input.subFindings.map((f) => ({
    severity: f.severity as V2ReviewFinding["severity"],
    file: f.file,
    line: f.line,
    quote: f.quote,
    title: f.title,
    message: f.message,
    suggestion: f.suggestion,
  }));

  const preDeduped = verifyAndDedupeFindings({
    findings: findingsForV2,
    maxFindings: findingsForV2.length,
  });

  const algoDedupCount =
    input.subFindings.length - preDeduped.length;
  console.log(
    `[cross-ref] Algorithmic dedup: ${input.subFindings.length} → ${preDeduped.length} (${algoDedupCount} duplicates removed)`,
  );

  if (preDeduped.length <= 3) {
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[cross-ref] Only ${preDeduped.length} findings after algo dedup — skipping LLM cross-ref`,
    );
    return {
      findings: preDeduped.map((f) => ({
        severity: f.severity,
        file: f.file,
        line: f.line,
        quote: f.quote,
        title: f.title,
        message: f.message,
        suggestion: f.suggestion,
      })),
      dedupCount: algoDedupCount,
      missedCount: 0,
      contradictoryPairs: [],
    };
  }

  try {
    const system = [
      "You are a PR review cross-reference agent.",
      "Your job is to deduplicate, cross-reference, and consolidate findings from multiple sub-agents.",
      "Output ONLY valid JSON. No markdown, no preamble.",
    ].join(" ");

    const prompt = buildCrossRefPrompt(input);

    const result = await generateText({
      model: input.model,
      system,
      prompt,
    });

    const parsed = parseCrossRefResponse(result.text ?? "");

    const llmFindings: V2ReviewFinding[] = parsed.findings.map((f) => ({
      severity: f.severity as V2ReviewFinding["severity"],
      file: f.file,
      line: f.line,
      quote: f.quote,
      title: f.title,
      message: f.message,
      suggestion: f.suggestion,
    }));

    const { merged, dedupCount: llmDedupCount } = crossRefDedupe(
      llmFindings,
      preDeduped,
    );

    const finalDeduped = verifyAndDedupeFindings({
      findings: merged,
      maxFindings: 30,
    });

    const totalDedupCount =
      algoDedupCount + llmDedupCount;
    const missedCount = parsed.missedIssues.length;

    if (missedCount > 0) {
      console.log(
        `[cross-ref] Missed issues detected:`,
        parsed.missedIssues.slice(0, 5),
      );
    }

    if (parsed.contradictoryPairs.length > 0) {
      console.log(
        `[cross-ref] Contradictions detected: ${parsed.contradictoryPairs.length} pairs`,
      );
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[cross-ref] Done in ${elapsedMs}ms — ${finalDeduped.length} final findings (removed ${totalDedupCount} duplicates, found ${missedCount} missed, ${parsed.contradictoryPairs.length} contradictions)`,
    );

    return {
      findings: finalDeduped.map((f) => ({
        severity: f.severity,
        file: f.file,
        line: f.line,
        quote: f.quote,
        title: f.title,
        message: f.message,
        suggestion: f.suggestion,
      })),
      dedupCount: totalDedupCount,
      missedCount,
      contradictoryPairs: parsed.contradictoryPairs,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const msg =
      error instanceof Error ? error.message : String(error);
    console.error(
      `[cross-ref] LLM cross-ref failed after ${elapsedMs}ms: ${msg}`,
    );

    return {
      findings: preDeduped.map((f) => ({
        severity: f.severity,
        file: f.file,
        line: f.line,
        quote: f.quote,
        title: f.title,
        message: f.message,
        suggestion: f.suggestion,
      })),
      dedupCount: algoDedupCount,
      missedCount: 0,
      contradictoryPairs: [],
    };
  }
}

import type { LanguageModel } from "ai";
import type { ReviewFinding } from "./schema/review-result";
import { runSubReview, type SubReviewResult } from "./sub-review";

export interface FanOutReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchSize?: number;
  maxConcurrency?: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function runSubReviews(
  input: FanOutReviewInput,
): Promise<SubReviewResult[]> {
  const batchSize = input.batchSize ?? 15;
  const chunks = chunkArray(input.files, batchSize);
  const totalBatches = chunks.length;

  const allPaths = input.files.map((f) => f.path);

  const batchInputs = chunks.map((chunk, i) => ({
    model: input.model,
    files: chunk,
    batchName: `${i + 1}/${totalBatches}`,
    batchIndex: i + 1,
    totalBatches,
    allChangedFiles: allPaths,
  }));

  const results = await Promise.all(
    batchInputs.map((bi) => runSubReview(bi)),
  );

  return results;
}

export function mergeSubFindings(results: SubReviewResult[]): ReviewFinding[] {
  return results.flatMap((r) => r.findings);
}

export function buildSubFindingsPrompt(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return "No findings were reported by sub-agents.";
  }

  const lines: string[] = [
    `Sub-agents reported ${findings.length} findings across all batches.`,
    "",
    "Your job: validate each finding against the actual codebase using readFile/grep.",
    "Cross-reference across files, deduplicate, adjust severity if needed.",
    "Add any new findings the sub-agents missed.",
    "",
    "Reported findings:",
  ];

  findings.forEach((f, i) => {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "unknown";
    lines.push(`  ${i + 1}. [${f.severity}] ${loc} — ${f.title}`);
    if (f.message) {
      lines.push(`     ${f.message.slice(0, 200)}`);
    }
  });

  return lines.join("\n");
}

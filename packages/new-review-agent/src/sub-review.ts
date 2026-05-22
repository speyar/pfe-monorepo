import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { reviewFindingSchema } from "./schema/review-result";
import type { ReviewFinding } from "./schema/review-result";

export interface SubReviewInput {
  model: LanguageModel;
  files: Array<{ path: string; patch: string }>;
  batchName: string;
  batchIndex: number;
  totalBatches: number;
  allChangedFiles: string[];
}

const subReviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export interface SubReviewResult {
  batchName: string;
  findings: ReviewFinding[];
}

function buildFileDiffText(files: Array<{ path: string; patch: string }>): string {
  return files
    .map((f) => {
      return [
        `diff --git a/${f.path} b/${f.path}`,
        `--- a/${f.path}`,
        `+++ b/${f.path}`,
        f.patch,
      ].join("\n");
    })
    .join("\n\n");
}

export async function runSubReview(input: SubReviewInput): Promise<SubReviewResult> {
  const fileList = input.files.map((f) => f.path).join("\n");
  const diffText = buildFileDiffText(input.files);

  const system = [
    "You are a PR review sub-agent. Review ONLY the files assigned to this batch.",
    "You do NOT have file system access. Analyze solely from the diffs below.",
    "",
    "Focus on: bugs, breaking changes, security issues, data integrity, and production risks.",
    "Be specific. Include file paths and line numbers when possible.",
    "Do NOT report findings for files outside your batch.",
    "Output findings as a JSON array.",
  ].join("\n");

  const prompt = [
    `You are reviewing batch ${input.batchIndex}/${input.totalBatches}.`,
    "",
    `All changed files in this PR (${input.allChangedFiles.length} total):`,
    input.allChangedFiles.map((f) => `  ${f}`).join("\n"),
    "",
    `Your batch (${input.files.length} files):`,
    fileList,
    "",
    "Diffs for your batch:",
    diffText,
    "",
    "Analyze the diffs and output findings for YOUR batch only.",
  ].join("\n");

  const result = await generateText({
    model: input.model,
    system,
    prompt,
    output: Output.object({
      schema: subReviewResultSchema,
      name: "sub_review_result",
      description: `Findings for batch ${input.batchName}.`,
    }),
  });

  return {
    batchName: input.batchName,
    findings: result.output?.findings ?? [],
  };
}

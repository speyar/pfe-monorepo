import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { createOpenaiCompatible } from "@ceira/better-copilot-provider";

const diffSummarySchema = z.object({
  intent: z.string().min(1),
  keyChanges: z.array(z.string().min(1)).max(3),
  riskPoints: z.array(z.string().min(1)).max(3),
  openQuestions: z.array(z.string().min(1)).max(2),
  evidence: z.array(z.string().min(1)).max(6),
});

export type DiffSummary = z.infer<typeof diffSummarySchema>;

export interface SummarizeDiffInput {
  model: LanguageModel;
  diff: string;
  signal?: AbortSignal;
}

export interface SummarizeDiffWithDefaultModelInput {
  diff: string;
  signal?: AbortSignal;
  modelName?: string;
}

const MAX_DIFF_CHARS = 50_000;

function parseDiffSummaryJson(text: string): DiffSummary | null {
  const cleaned = text.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return diffSummarySchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function summarizeDiff(
  input: SummarizeDiffInput,
): Promise<DiffSummary | null> {
  const diff = input.diff.trim();
  if (!diff) {
    return null;
  }

  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n... [truncated ${diff.length - MAX_DIFF_CHARS} chars]`
    : diff;

  const result = await generateText({
    model: input.model,
    system: [
      "You summarize unified git diffs for a PR review agent.",
      "Return only what is directly supported by the diff.",
      "Keep output concise, concrete, and evidence-based.",
      "Do not infer business context not present in diff.",
      "",
      "Output a SINGLE JSON object. Example:",
      '{"intent":"...","keyChanges":["..."],"riskPoints":["..."],"openQuestions":["..."],"evidence":["..."]}',
      "Output ONLY the JSON. No markdown fences, no preamble.",
    ].join(" "),
    prompt: [
      "Summarize the diff into the required JSON fields:",
      "- intent: one sentence",
      "- keyChanges: 2-3 bullets of behavior-impacting changes",
      "- riskPoints: 1-3 likely misunderstanding/bug-prone areas",
      "- openQuestions: 0-2 unknowns not provable from diff",
      "- evidence: up to 6 file/line or hunk references backing claims",
      "",
      "Diff:",
      truncatedDiff,
    ].join("\n"),
    abortSignal: input.signal,
  });

  return parseDiffSummaryJson(result.text ?? "");
}

export async function summarizeDiffWithDefaultModel(
  input: SummarizeDiffWithDefaultModelInput,
): Promise<DiffSummary | null> {
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
  if (!copilotToken) {
    return null;
  }

  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
  });

  return summarizeDiff({
    model: provider(
      input.modelName ?? process.env.REVIEW_MODEL ?? "gpt-5.4-mini",
    ),
    diff: input.diff,
    signal: input.signal,
  });
}

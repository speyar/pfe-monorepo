import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import { estimateTokenCount } from "./tools/shared";

const diffSummarySchema = z.object({
  intent: z.string().default(""),
  keyChanges: z.array(z.string()).max(3).catch([]),
  riskPoints: z.array(z.string()).max(3).catch([]),
  openQuestions: z.array(z.string()).max(2).catch([]),
  evidence: z.array(z.string()).max(6).catch([]),
});

export type DiffSummary = z.infer<typeof diffSummarySchema>;

export interface SummarizeDiffInput {
  model: LanguageModel;
  diff: string;
  signal?: AbortSignal;
}

export interface SummarizeDiffWithDefaultModelInput {
  diff?: string;
  files?: DiffFileInput[];
  signal?: AbortSignal;
  modelName?: string;
}

export interface DiffFileInput {
  path: string;
  patch: string;
}

interface DiffSection {
  text: string;
  estimatedTokens: number;
}

interface FileDiffEntry {
  path: string;
  text: string;
  estimatedTokens: number;
}

interface FileBatch {
  id: number;
  entries: FileDiffEntry[];
  estimatedTokens: number;
}

const DEFAULT_CHUNK_MAX_TOKENS = 40_000;
const DEFAULT_MAX_CHUNKS = 12;
const DEFAULT_CHUNK_TRIGGER_TOKENS = 50_000;
const DEFAULT_FILE_BATCH_MAX_TOKENS = 40_000;
const DEFAULT_FILE_SUMMARY_CONCURRENCY = 3;
const DEFAULT_MERGE_MAX_SUMMARIES = 40;
const FALLBACK_INTENT =
  "Large pull request changes were summarized with constrained context.";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function uniqueLimit(items: string[], limit: number): string[] {
  const unique = Array.from(new Set(items.map((item) => item.trim()))).filter(
    (item) => item.length > 0,
  );
  return unique.slice(0, limit);
}

function normalizeCandidateSummary(candidate: unknown): DiffSummary | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const intentRaw =
    typeof record.intent === "string" ? record.intent.trim() : "";

  const normalized: DiffSummary = {
    intent: intentRaw.length > 0 ? intentRaw : FALLBACK_INTENT,
    keyChanges: uniqueLimit(toStringArray(record.keyChanges), 3),
    riskPoints: uniqueLimit(toStringArray(record.riskPoints), 3),
    openQuestions: uniqueLimit(toStringArray(record.openQuestions), 2),
    evidence: uniqueLimit(toStringArray(record.evidence), 6),
  };

  const parsed = diffSummarySchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function parseJsonObjectFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to best-effort extraction.
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function mergeSummariesLocally(
  summaries: DiffSummary[],
  options?: { coveredChunks?: number; totalChunks?: number },
): DiffSummary {
  const intent =
    summaries.find((summary) => summary.intent.trim().length > 0)?.intent ??
    FALLBACK_INTENT;

  const merged: DiffSummary = {
    intent,
    keyChanges: uniqueLimit(
      summaries.flatMap((summary) => summary.keyChanges),
      3,
    ),
    riskPoints: uniqueLimit(
      summaries.flatMap((summary) => summary.riskPoints),
      3,
    ),
    openQuestions: uniqueLimit(
      summaries.flatMap((summary) => summary.openQuestions),
      2,
    ),
    evidence: uniqueLimit(
      summaries.flatMap((summary) => summary.evidence),
      6,
    ),
  };

  if (
    options?.coveredChunks &&
    options?.totalChunks &&
    options.totalChunks > options.coveredChunks
  ) {
    merged.openQuestions = uniqueLimit(
      [
        ...merged.openQuestions,
        `Summary covers ${options.coveredChunks}/${options.totalChunks} diff chunks due configured limits.`,
      ],
      2,
    );
  }

  return merged;
}

function splitDiffByFileBlocks(diff: string): string[] {
  const lines = diff.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ") && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }

  const normalized = blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return normalized.length > 0 ? normalized : [diff];
}

function splitFileBlockByHunks(fileBlock: string): string[] {
  const lines = fileBlock.split("\n");
  const hunkStartIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("@@ ")) {
      hunkStartIndexes.push(index);
    }
  }

  if (hunkStartIndexes.length === 0) {
    return [fileBlock];
  }

  const fileHeader = lines.slice(0, hunkStartIndexes[0]).join("\n").trimEnd();
  const sections: string[] = [];

  for (let index = 0; index < hunkStartIndexes.length; index += 1) {
    const start = hunkStartIndexes[index] as number;
    const end = hunkStartIndexes[index + 1] ?? lines.length;
    const hunk = lines.slice(start, end).join("\n").trim();
    if (!hunk) {
      continue;
    }

    const combined = `${fileHeader}\n${hunk}`.trim();
    sections.push(combined);
  }

  return sections.length > 0 ? sections : [fileBlock];
}

function splitTextByTokenBudget(text: string, maxTokens: number): string[] {
  if (maxTokens < 1) {
    return [];
  }

  if (estimateTokenCount(text) <= maxTokens) {
    return [text];
  }

  const lines = text.split("\n");
  const parts: string[] = [];
  let currentLines: string[] = [];
  let currentTokens = 0;

  const flushCurrent = (): void => {
    if (currentLines.length === 0) {
      return;
    }

    parts.push(currentLines.join("\n"));
    currentLines = [];
    currentTokens = 0;
  };

  for (const line of lines) {
    const lineTokens = estimateTokenCount(line) + 1;

    if (lineTokens > maxTokens) {
      flushCurrent();

      const maxCharsPerPart = Math.max(1, maxTokens * 4);
      for (let offset = 0; offset < line.length; offset += maxCharsPerPart) {
        const segment = line.slice(offset, offset + maxCharsPerPart);
        if (segment.length > 0) {
          parts.push(segment);
        }
      }
      continue;
    }

    const exceedsBudget =
      currentLines.length > 0 && currentTokens + lineTokens > maxTokens;
    if (exceedsBudget) {
      flushCurrent();
    }

    currentLines.push(line);
    currentTokens += lineTokens;
  }

  flushCurrent();
  return parts.filter((part) => part.trim().length > 0);
}

function toSections(diff: string, maxChunkTokens: number): DiffSection[] {
  const sections: DiffSection[] = [];
  const blocks = splitDiffByFileBlocks(diff);

  for (const block of blocks) {
    const blockTokens = estimateTokenCount(block);
    if (blockTokens <= maxChunkTokens) {
      sections.push({ text: block, estimatedTokens: blockTokens });
      continue;
    }

    const hunkSections = splitFileBlockByHunks(block);
    for (const hunkSection of hunkSections) {
      const hunkTokens = estimateTokenCount(hunkSection);
      if (hunkTokens <= maxChunkTokens) {
        sections.push({ text: hunkSection, estimatedTokens: hunkTokens });
        continue;
      }

      const splitHunkSections = splitTextByTokenBudget(
        hunkSection,
        maxChunkTokens,
      );
      for (const splitHunkSection of splitHunkSections) {
        sections.push({
          text: splitHunkSection,
          estimatedTokens: estimateTokenCount(splitHunkSection),
        });
      }
    }
  }

  return sections;
}

function packSectionsIntoChunks(
  sections: DiffSection[],
  maxChunkTokens: number,
): string[] {
  const chunks: string[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;

  for (const section of sections) {
    const sectionWithSeparatorTokens = section.estimatedTokens + 4;
    const shouldFlush =
      currentParts.length > 0 &&
      currentTokens + sectionWithSeparatorTokens > maxChunkTokens;

    if (shouldFlush) {
      chunks.push(currentParts.join("\n\n"));
      currentParts = [];
      currentTokens = 0;
    }

    currentParts.push(section.text);
    currentTokens += sectionWithSeparatorTokens;
  }

  if (currentParts.length > 0) {
    chunks.push(currentParts.join("\n\n"));
  }

  return chunks;
}

function buildDiffBlockFromFile(file: DiffFileInput): string {
  return [
    `diff --git a/${file.path} b/${file.path}`,
    `--- a/${file.path}`,
    `+++ b/${file.path}`,
    file.patch,
  ].join("\n");
}

function buildDiffFromFileEntries(entries: FileDiffEntry[]): string {
  return entries.map((entry) => entry.text).join("\n\n");
}

function buildFileDiffEntries(
  files: DiffFileInput[],
  maxTokensPerBatch: number,
): FileDiffEntry[] {
  const entries: FileDiffEntry[] = [];

  for (const file of files) {
    const diffBlock = buildDiffBlockFromFile(file);
    const estimatedTokens = estimateTokenCount(diffBlock);
    if (estimatedTokens <= maxTokensPerBatch) {
      entries.push({
        path: file.path,
        text: diffBlock,
        estimatedTokens,
      });
      continue;
    }

    const sections = toSections(diffBlock, maxTokensPerBatch);
    for (const section of sections) {
      entries.push({
        path: file.path,
        text: section.text,
        estimatedTokens: section.estimatedTokens,
      });
    }
  }

  return entries;
}

function groupFilesIntoBatches(
  files: DiffFileInput[],
  maxTokensPerBatch: number,
): FileBatch[] {
  const entries = buildFileDiffEntries(files, maxTokensPerBatch).sort(
    (left, right) => right.estimatedTokens - left.estimatedTokens,
  );

  const batches: FileBatch[] = [];

  for (const entry of entries) {
    let chosenBatch: FileBatch | null = null;

    for (const batch of batches) {
      if (
        batch.estimatedTokens + entry.estimatedTokens + 4 <=
        maxTokensPerBatch
      ) {
        chosenBatch = batch;
        break;
      }
    }

    if (!chosenBatch) {
      chosenBatch = {
        id: batches.length + 1,
        entries: [],
        estimatedTokens: 0,
      };
      batches.push(chosenBatch);
    }

    chosenBatch.entries.push(entry);
    chosenBatch.estimatedTokens += entry.estimatedTokens + 4;
  }

  return batches;
}

async function mapWithConcurrency<T, R>(input: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const results: R[] = new Array(input.items.length);
  const concurrency = Math.max(1, input.concurrency);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < input.items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await input.worker(
        input.items[currentIndex] as T,
        currentIndex,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, input.items.length) }, () =>
      runWorker(),
    ),
  );

  return results;
}

async function summarizeFileBatch(input: {
  model: LanguageModel;
  batch: FileBatch;
  signal?: AbortSignal;
}): Promise<{ batchId: number; filePaths: string[]; summary: DiffSummary }> {
  const filePaths = Array.from(
    new Set(input.batch.entries.map((entry) => entry.path)),
  );
  const diff = buildDiffFromFileEntries(input.batch.entries);
  const summary = await summarizeDiff({
    model: input.model,
    diff,
    signal: input.signal,
  });

  if (!summary) {
    throw new Error(`Batch ${input.batch.id} returned an empty summary.`);
  }

  return {
    batchId: input.batch.id,
    filePaths,
    summary,
  };
}

async function orchestratorMerge(input: {
  model: LanguageModel;
  summaries: Array<{
    batchId: number;
    filePaths: string[];
    summary: DiffSummary;
  }>;
  totalBatches: number;
  totalFiles: number;
  signal?: AbortSignal;
}): Promise<DiffSummary> {
  if (input.summaries.length === 1) {
    return input.summaries[0]?.summary as DiffSummary;
  }

  const maxSummariesForLlmMerge = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_MERGE_MAX_SUMMARIES,
    DEFAULT_MERGE_MAX_SUMMARIES,
  );

  if (input.summaries.length > maxSummariesForLlmMerge) {
    console.warn(
      "[diff-summarizer] too many batch summaries for LLM merge; using local merge",
      {
        summaryCount: input.summaries.length,
        maxSummariesForLlmMerge,
        totalBatches: input.totalBatches,
        totalFiles: input.totalFiles,
      },
    );

    return mergeSummariesLocally(
      input.summaries.map((batchSummary) => batchSummary.summary),
      {
        coveredChunks: input.summaries.length,
        totalChunks: input.totalBatches,
      },
    );
  }

  const coveredFiles = new Set(
    input.summaries.flatMap((batchSummary) => batchSummary.filePaths),
  ).size;

  const summariesText = input.summaries
    .map(
      (batchSummary) =>
        `Batch ${batchSummary.batchId} (files: ${batchSummary.filePaths.join(", ")}): ${JSON.stringify(batchSummary.summary)}`,
    )
    .join("\n");

  console.log("[diff-summarizer] orchestrator merge start", {
    partialSummaries: input.summaries.length,
    totalBatches: input.totalBatches,
    coveredFiles,
    totalFiles: input.totalFiles,
  });

  try {
    const result = await generateText({
      model: input.model,
      system: [
        "You merge partial PR diff summaries produced by parallel subagents.",
        "Keep only high-signal changes and avoid duplicates.",
        "Return only what is directly supported by subagent summaries.",
        "Keep output concise and concrete.",
      ].join(" "),
      prompt: [
        "Merge these subagent summaries into the required JSON fields:",
        "- intent: one sentence",
        "- keyChanges: 2-3 bullets of behavior-impacting changes",
        "- riskPoints: 1-3 likely misunderstanding/bug-prone areas",
        "- openQuestions: 0-2 unknowns not provable from summaries",
        "- evidence: up to 6 file/line or hunk references backing claims",
        "",
        `Coverage: summarized ${input.summaries.length}/${input.totalBatches} subagent batches and ${coveredFiles}/${input.totalFiles} files.`,
        summariesText,
      ].join("\n"),
      output: Output.object({
        schema: diffSummarySchema,
        name: "diff_summary",
        description: "Concise, grounded summary of a PR diff.",
      }),
      abortSignal: input.signal,
    });

    const merged = result.output;

    console.log("[diff-summarizer] orchestrator merge finish", {
      partialSummaries: input.summaries.length,
      totalBatches: input.totalBatches,
      intent: merged.intent,
      keyChanges: merged.keyChanges,
      riskPoints: merged.riskPoints,
      evidenceCount: merged.evidence.length,
    });

    return merged;
  } catch (error) {
    console.warn(
      "[diff-summarizer] orchestrator merge failed; using local merge",
      {
        error: error instanceof Error ? error.message : String(error),
        partialSummaries: input.summaries.length,
        totalBatches: input.totalBatches,
        coveredFiles,
        totalFiles: input.totalFiles,
      },
    );

    return mergeSummariesLocally(
      input.summaries.map((batchSummary) => batchSummary.summary),
      {
        coveredChunks: input.summaries.length,
        totalChunks: input.totalBatches,
      },
    );
  }
}

async function summarizeDiffByFileBatches(input: {
  model: LanguageModel;
  files: DiffFileInput[];
  signal?: AbortSignal;
}): Promise<DiffSummary | null> {
  const normalizedFiles = input.files
    .map((file) => ({
      path: file.path.trim(),
      patch: file.patch,
    }))
    .filter((file) => file.path.length > 0 && file.patch.trim().length > 0);

  if (normalizedFiles.length === 0) {
    return null;
  }

  const maxBatchTokens = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_FILE_BATCH_MAX_TOKENS,
    DEFAULT_FILE_BATCH_MAX_TOKENS,
  );
  const concurrency = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_CONCURRENCY,
    DEFAULT_FILE_SUMMARY_CONCURRENCY,
  );

  const batches = groupFilesIntoBatches(normalizedFiles, maxBatchTokens);

  console.log("[diff-summarizer] subagent orchestration planned", {
    files: normalizedFiles.length,
    batches: batches.length,
    concurrency,
    maxBatchTokens,
  });

  const batchResults = await mapWithConcurrency({
    items: batches,
    concurrency,
    worker: async (batch) => {
      const uniquePaths = Array.from(
        new Set(batch.entries.map((entry) => entry.path)),
      );
      console.log("[diff-summarizer][subagent] start", {
        batchId: batch.id,
        fileCount: uniquePaths.length,
        estimatedTokens: batch.estimatedTokens,
      });

      try {
        const result = await summarizeFileBatch({
          model: input.model,
          batch,
          signal: input.signal,
        });

        console.log("[diff-summarizer][subagent] finish", {
          batchId: batch.id,
          fileCount: result.filePaths.length,
          files: result.filePaths,
          intent: result.summary.intent,
          keyChanges: result.summary.keyChanges,
          riskPoints: result.summary.riskPoints,
          evidenceCount: result.summary.evidence.length,
        });

        return result;
      } catch (error) {
        console.warn("[diff-summarizer][subagent] failed", {
          batchId: batch.id,
          fileCount: uniquePaths.length,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
  });

  const successfulResults = batchResults.filter(
    (result): result is NonNullable<typeof result> => result !== null,
  );

  console.log("[diff-summarizer] subagent orchestration completed", {
    totalBatches: batches.length,
    successfulBatches: successfulResults.length,
    failedBatches: batches.length - successfulResults.length,
  });

  if (successfulResults.length === 0) {
    return null;
  }

  return orchestratorMerge({
    model: input.model,
    summaries: successfulResults,
    totalBatches: batches.length,
    totalFiles: normalizedFiles.length,
    signal: input.signal,
  });
}

async function reduceChunkSummaries(input: {
  model: LanguageModel;
  summaries: DiffSummary[];
  signal?: AbortSignal;
  chunkCount: number;
  totalChunkCount: number;
}): Promise<DiffSummary> {
  const chunksText = input.summaries
    .map((summary, index) => `Chunk ${index + 1}: ${JSON.stringify(summary)}`)
    .join("\n");

  try {
    const result = await generateText({
      model: input.model,
      system: [
        "You merge partial PR diff summaries into one grounded summary.",
        "Keep only high-signal changes and avoid duplicates.",
        "Return only what is directly supported by chunk summaries.",
        "Keep output concise and concrete.",
      ].join(" "),
      prompt: [
        "Merge these chunk summaries into the required JSON fields:",
        "- intent: one sentence",
        "- keyChanges: 2-3 bullets of behavior-impacting changes",
        "- riskPoints: 1-3 likely misunderstanding/bug-prone areas",
        "- openQuestions: 0-2 unknowns not provable from summaries",
        "- evidence: up to 6 file/line or hunk references backing claims",
        "",
        `Coverage: summarized ${input.chunkCount} of ${input.totalChunkCount} chunks.`,
        chunksText,
      ].join("\n"),
      output: Output.object({
        schema: diffSummarySchema,
        name: "diff_summary",
        description: "Concise, grounded summary of a PR diff.",
      }),
      abortSignal: input.signal,
    });

    return result.output;
  } catch (error) {
    console.warn(
      "[diff-summarizer] reduce schema validation failed; using local merge",
      {
        error: error instanceof Error ? error.message : String(error),
        chunkCount: input.chunkCount,
        totalChunkCount: input.totalChunkCount,
      },
    );

    return mergeSummariesLocally(input.summaries, {
      coveredChunks: input.chunkCount,
      totalChunks: input.totalChunkCount,
    });
  }
}

async function summarizeDiffChunked(
  input: SummarizeDiffInput,
): Promise<DiffSummary | null> {
  const diff = input.diff.trim();
  if (!diff) {
    return null;
  }

  const maxChunkTokens = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_CHUNK_MAX_TOKENS,
    DEFAULT_CHUNK_MAX_TOKENS,
  );
  const maxChunks = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_MAX_CHUNKS,
    DEFAULT_MAX_CHUNKS,
  );

  const sections = toSections(diff, maxChunkTokens);
  const allChunks = packSectionsIntoChunks(sections, maxChunkTokens);
  const selectedChunks = allChunks.slice(0, maxChunks);

  console.log("[diff-summarizer] chunked mode", {
    totalSections: sections.length,
    totalChunks: allChunks.length,
    selectedChunks: selectedChunks.length,
    maxChunks,
    maxChunkTokens,
  });

  const partialSummaries: DiffSummary[] = [];
  for (const chunk of selectedChunks) {
    const partial = await summarizeDiff({
      model: input.model,
      diff: chunk,
      signal: input.signal,
    }).catch((error) => {
      console.warn("[diff-summarizer] chunk summarize failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (partial) {
      partialSummaries.push(partial);
    }
  }

  if (partialSummaries.length === 0) {
    return null;
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0] as DiffSummary;
  }

  return reduceChunkSummaries({
    model: input.model,
    summaries: partialSummaries,
    signal: input.signal,
    chunkCount: partialSummaries.length,
    totalChunkCount: allChunks.length,
  });
}

export async function summarizeDiff(
  input: SummarizeDiffInput,
): Promise<DiffSummary | null> {
  const diff = input.diff.trim();
  if (!diff) {
    return null;
  }

  const systemPrompt = [
    "You summarize unified git diffs for a PR review agent.",
    "Return strict JSON only with keys: intent, keyChanges, riskPoints, openQuestions, evidence.",
    "No markdown fences. No extra keys. No prose outside JSON.",
    "Return only what is directly supported by the diff.",
    "Keep output concise, concrete, and evidence-based.",
    "Do not infer business context not present in diff.",
  ].join(" ");

  const userPrompt = [
    "Summarize the diff into the required JSON fields:",
    "- intent: one sentence",
    "- keyChanges: 2-3 bullets of behavior-impacting changes",
    "- riskPoints: 1-3 likely misunderstanding/bug-prone areas",
    "- openQuestions: 0-2 unknowns not provable from diff",
    "- evidence: up to 6 file/line or hunk references backing claims",
    "",
    "Diff:",
    diff,
  ].join("\n");

  try {
    const result = await generateText({
      model: input.model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: input.signal,
    });

    const parsed = parseJsonObjectFromText(result.text ?? "");
    const normalized = normalizeCandidateSummary(parsed);
    if (normalized) {
      return normalized;
    }
  } catch (error) {
    console.warn("[diff-summarizer] JSON generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    intent: FALLBACK_INTENT,
    keyChanges: [],
    riskPoints: [],
    openQuestions: [
      "Model response could not be validated against summary schema.",
    ],
    evidence: [],
  };
}

export async function summarizeDiffWithDefaultModel(
  input: SummarizeDiffWithDefaultModelInput,
): Promise<DiffSummary | null> {
  const apiKey = process.env.OPENCODEGO_API_KEY;
  if (!apiKey) {
    return null;
  }

  const modelName =
    input.modelName ?? process.env.OPENCODEGO_MODEL ?? "kimi-k2.5";

  const model = createOpenCodeGoModel(modelName);

  const normalizedFiles =
    input.files?.filter((file) => file.patch.trim().length > 0) ?? [];

  if (normalizedFiles.length > 0) {
    const estimatedTokensFromFiles = normalizedFiles.reduce((total, file) => {
      return total + estimateTokenCount(buildDiffBlockFromFile(file));
    }, 0);

    const fileBatchTriggerTokens = parsePositiveInt(
      process.env.REVIEW_DIFF_SUMMARY_CHUNK_TRIGGER_TOKENS,
      DEFAULT_CHUNK_TRIGGER_TOKENS,
    );

    if (estimatedTokensFromFiles >= fileBatchTriggerTokens) {
      console.log("[diff-summarizer] switching to subagent orchestrator mode", {
        estimatedTokens: estimatedTokensFromFiles,
        fileBatchTriggerTokens,
        files: normalizedFiles.length,
      });

      return summarizeDiffByFileBatches({
        model,
        files: normalizedFiles,
        signal: input.signal,
      });
    }
  }

  const diff = input.diff ?? "";
  const estimatedTokens = estimateTokenCount(diff);
  const chunkTriggerTokens = parsePositiveInt(
    process.env.REVIEW_DIFF_SUMMARY_CHUNK_TRIGGER_TOKENS,
    DEFAULT_CHUNK_TRIGGER_TOKENS,
  );

  if (estimatedTokens >= chunkTriggerTokens) {
    console.log("[diff-summarizer] switching to chunked mode", {
      estimatedTokens,
      chunkTriggerTokens,
    });

    return summarizeDiffChunked({
      model,
      diff,
      signal: input.signal,
    });
  }

  return summarizeDiff({
    model,
    diff,
    signal: input.signal,
  });
}

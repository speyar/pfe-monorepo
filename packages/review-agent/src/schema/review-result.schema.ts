import { z } from "zod";
import { REVIEW_SEVERITIES, REVIEW_VERDICTS } from "../contracts/review-result";

export const reviewFindingSchema = z.object({
  severity: z.enum(REVIEW_SEVERITIES),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  suggestion: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const reviewSummarySchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  score: z.number().min(0).max(100),
  overview: z.string().min(1),
  risk: z.string().min(1),
  model: z.string().min(1).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

export const reviewResultSchema = z.object({
  summary: reviewSummarySchema,
  findings: z.array(reviewFindingSchema),
  notes: z.array(z.string().min(1)).optional(),
});

export type ReviewResultSchema = z.infer<typeof reviewResultSchema>;

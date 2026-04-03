import { z } from "zod";

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  quote: z.string().min(1).optional(),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  suggestion: z.string().min(1).max(200).optional(),
});

export const reviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;

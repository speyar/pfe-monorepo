import { z } from "zod";

export const changedFileSchema = z.object({
  path: z.string().min(1),
  description: z.string().min(1),
});

export const fixResultSchema = z.object({
  summary: z.string().min(1).describe("Human-readable summary of what the fix does"),
  rootCause: z.string().min(1).describe("Root cause analysis of the bug"),
  verificationPassed: z.boolean().describe("Whether lint/typecheck passes after the fix"),
  verificationNotes: z.string().optional().describe("Output from verification commands"),
  filesChanged: z.array(changedFileSchema).min(1).describe("Files that were modified"),
  confident: z.boolean().describe("Whether the agent is confident the fix is correct"),
});

export type FixResult = z.infer<typeof fixResultSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;

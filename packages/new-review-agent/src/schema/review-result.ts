import { z } from "zod";

export const reviewFindingSchema = z.object({
  severity: z.enum(["P0", "P1", "P2", "P3", "P4"]).catch("P3"),
  file: z.string().optional(),
  line: z.number().int().positive().optional().catch(undefined),
  quote: z.string().optional(),
  title: z.string().max(100).default("Issue"),
  message: z.string().max(4000).default("No description"),
  suggestion: z.string().optional(),
});

export const agentSummarySchema = z.object({
  agentId: z.string(),
  summary: z.string(),
});

export const subAgentResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export const reviewResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

export const orchestratorResultSchema = z.object({
  findings: z.array(reviewFindingSchema),
  agentSummaries: z.array(agentSummarySchema),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type SubAgentResult = z.infer<typeof subAgentResultSchema>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type OrchestratorResult = z.infer<typeof orchestratorResultSchema>;

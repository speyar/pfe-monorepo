import { z } from "zod";

export const GitInputSchema = z.object({
  operation: z
    .enum(["status", "switch", "blame"])
    .describe("Git operation to perform: status, switch, or blame."),
  args: z
    .string()
    .optional()
    .describe(
      "Arguments for the git operation. For 'switch': branch name. For 'blame': file path. For 'status': no args needed.",
    ),
});

export type GitInput = z.infer<typeof GitInputSchema>;

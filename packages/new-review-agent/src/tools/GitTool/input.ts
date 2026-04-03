import { z } from "zod";

export const GitInputSchema = z.object({
  operation: z
    .enum(["status", "switch", "blame", "branch", "fetch"])
    .describe("Git operation: status, switch, blame, branch (list), or fetch."),
  args: z
    .string()
    .optional()
    .describe(
      "Arguments: For 'switch': branch name. For 'blame': file path. For 'branch': none. For 'fetch': none.",
    ),
});

export type GitInput = z.infer<typeof GitInputSchema>;

import { z } from "zod";

export const GitInputSchema = z.object({
  operation: z
    .enum(["blame", "diff"])
    .describe("Git operation: blame or diff."),
  args: z
    .string()
    .optional()
    .describe(
      "Arguments: For 'blame': file path. For 'diff': commit range (e.g., 'main..HEAD').",
    ),
});

export type GitInput = z.infer<typeof GitInputSchema>;

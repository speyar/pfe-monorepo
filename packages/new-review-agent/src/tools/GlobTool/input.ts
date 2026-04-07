import { z } from "zod";

export const GlobInputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe(
      "The glob pattern to match files against (e.g., '*.ts', 'src/**/*.js', '**/*.json').",
    ),
  path: z
    .string()
    .optional()
    .describe("Directory path to search in. Defaults to current directory."),
  type: z
    .string()
    .optional()
    .describe(
      "Filter by file type: 'f' for files only, 'd' for directories only.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum number of results to return."),
});

export type GlobInput = z.infer<typeof GlobInputSchema>;

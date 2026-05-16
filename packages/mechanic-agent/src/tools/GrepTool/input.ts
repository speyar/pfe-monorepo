import { z } from "zod";

export const GrepInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search pattern/query to find in files."),
  path: z
    .string()
    .optional()
    .describe(
      "Directory or file path to search in. Defaults to current directory.",
    ),
  options: z
    .string()
    .optional()
    .describe(
      "Additional grep options: -i (case-insensitive), -n (line numbers), -r (recursive), -w (whole word), -C (context lines), -v (invert match), -l (list files), -e (extended regex).",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum number of matches to return."),
});

export type GrepInput = z.infer<typeof GrepInputSchema>;

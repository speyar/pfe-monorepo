import { z } from "zod";

export const ReadFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path to the file to read (relative or absolute)."),
  lineStart: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Starting line number (1-indexed). If not provided, reads from the beginning.",
    ),
  lineEnd: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Ending line number (1-indexed). If not provided, reads to the end.",
    ),
  maxLines: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum number of lines to read. Alternative to lineStart/lineEnd.",
    ),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Maximum number of tokens to return. If provided, the tool will limit output to this many tokens.",
    ),
  options: z
    .string()
    .optional()
    .describe(
      "Additional cat options: -n (line numbers), -b (numbered non-empty lines), -s (squeeze blank lines).",
    ),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

import { z } from "zod";

export const LsInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Directory path to list, could be relative or absolute, could be empty for current directory",
    ),
  options: z
    .string()
    .optional()
    .describe("Optional flags: -l, -a, -R, -t, -S, -d, -h"),
});

export type LsInput = z.infer<typeof LsInputSchema>;

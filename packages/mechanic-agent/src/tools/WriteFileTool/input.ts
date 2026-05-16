import { z } from "zod";

export const WriteFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path to the file to write (relative or absolute from repo root)."),
  content: z
    .string()
    .describe("The full content to write to the file."),
});

export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

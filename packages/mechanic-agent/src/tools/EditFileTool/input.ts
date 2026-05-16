import { z } from "zod";

export const EditFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Path to the file to edit (relative or absolute from repo root)."),
  search: z
    .string()
    .min(1)
    .describe("The exact text to search for (unique match required)."),
  replace: z
    .string()
    .describe("The replacement text."),
});

export type EditFileInput = z.infer<typeof EditFileInputSchema>;

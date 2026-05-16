import { z } from "zod";

export const RunCommandInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe("The shell command to run (e.g., 'npm run lint', 'npm run typecheck', 'npm test')."),
  workdir: z
    .string()
    .optional()
    .describe("Working directory to run the command in (relative or absolute). Defaults to repo root."),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Timeout in milliseconds for the command."),
});

export type RunCommandInput = z.infer<typeof RunCommandInputSchema>;

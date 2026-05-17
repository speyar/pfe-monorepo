import { z } from "zod";

export const CodebaseGraphInputSchema = z.object({
  query: z
    .enum([
      "findCallersOf",
      "findDependenciesOf",
      "findImpactOf",
      "findUnusedFunctions",
      "getChangedFileNodes",
      "getNodesByName",
      "getCrossPackageDeps",
      "getNodeDetails",
    ])
    .describe("The type of graph query to execute."),
  name: z
    .string()
    .optional()
    .describe(
      "Name of a function, method, class, or variable to query. Used with findCallersOf, findDependenciesOf, getNodesByName.",
    ),
  filePath: z
    .string()
    .optional()
    .describe(
      "File path (relative or absolute) to query. Used with findImpactOf, getChangedFileNodes.",
    ),
  nodeId: z
    .string()
    .optional()
    .describe(
      "Specific node ID to look up details for. Used with getNodeDetails.",
    ),
  changedFiles: z
    .array(z.string())
    .optional()
    .describe(
      "List of changed file paths from git diff. Used with getChangedFileNodes.",
    ),
});

export type CodebaseGraphInput = z.infer<typeof CodebaseGraphInputSchema>;

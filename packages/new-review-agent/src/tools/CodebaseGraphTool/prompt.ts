export const CODEBASE_GRAPH_TOOL_PROMPT = `The codebaseGraph tool queries a precomputed codebase dependency graph to answer structural questions about the codebase.

When to use:
- Find all callers of a changed function (who calls this function?)
- Find what dependencies a function has (what does this function call/use?)
- Find the blast radius of a file change (what other files are affected?)
- Find unused functions (dead code detection)
- Find cross-package dependencies (monorepo boundary violations)
- Look up node details by name (where is this symbol defined?)
- Get all graph nodes for changed files

Queries:
- findCallersOf: Given a function/method name, find all nodes that call it. Returns caller name, kind, file, and whether it's cross-package.
- findDependenciesOf: Given a function/method name, find all nodes it calls or uses. Returns callee name, kind, and edge type.
- findImpactOf: Given a file path, find all other files impacted by changes to that file (BFS traversal). Returns impacted file paths and why.
- findUnusedFunctions: Find all functions/methods that have no callers and are not exported. Returns name, kind, and file path.
- getChangedFileNodes: Given a list of changed file paths, return all graph nodes (functions, classes, methods, etc.) inside those files.
- getNodesByName: Search for nodes by name (case-insensitive substring match). Returns matching nodes with details.
- getCrossPackageDeps: List all cross-package dependencies in the codebase. Returns from-package, to-package, via-file, and import path.
- getNodeDetails: Get full details of a specific node by its ID. Returns all properties including signature, return type, parameters.

This is faster and more accurate than using grep for structural queries. Prefer this tool for dependency and call-graph questions.`;

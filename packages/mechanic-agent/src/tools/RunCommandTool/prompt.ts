const RUNCOMMAND_TOOL_NAME = "runCommand";

export const RUNCOMMAND_TOOL_PROMPT = `The ${RUNCOMMAND_TOOL_NAME} tool executes a shell command in the sandbox.

When to use:
- Run the linter: "npm run lint" or "bun run lint"
- Check types: "npm run typecheck" or "bun run typecheck" or "npx tsc --noEmit"
- Run tests: "npm test" or "bun test"
- Run the build: "npm run build" or "bun run build"
- Format code: "npx prettier --write <file>"

Parameters:
- command: The shell command to run.
- workdir (optional): Working directory for the command. Defaults to repo root.
- timeout (optional): Timeout in milliseconds.

Output: Returns stdout, stderr, and exit code.

IMPORTANT: Use this to verify your fixes compile/lint correctly before finishing.`;

const GIT_TOOL_NAME = "git";

export const GIT_TOOL_PROMPT = `The ${GIT_TOOL_NAME} tool performs Git operations for reviewing code changes.

When to use:
- git diff: View changes between commits/branches (e.g., 'main..HEAD' to see all changes on current branch)
- git blame: See who wrote each line of a file

IMPORTANT: The branch is already set up. Do NOT use status, fetch, branch, or switch - they are disabled.

Parameters:
- operation: 'diff' or 'blame' only.
- args: For 'diff': commit range (e.g., 'main..HEAD'). For 'blame': file path.

Example usage:
- "git operation=diff args=main..HEAD" - see all changes on current branch
- "git operation=diff args=HEAD~1..HEAD" - see last commit changes
- "git operation=blame args=src/index.ts" - see who wrote each line`;

const GIT_TOOL_NAME = "git";

export const GIT_TOOL_PROMPT = `The ${GIT_TOOL_NAME} tool performs Git operations for repository exploration and context.

When to use:
- Check current branch and git status
- List all branches (including remote)
- Fetch latest remote branches
- Switch to a different branch
- Use git blame to see who wrote each line of a file

Parameters:
- operation: The git operation to perform.
  - status: Shows current branch, working tree status, and staged/unstaged changes.
  - branch: Lists all local and remote branches (-a).
  - fetch: Fetches all remote branches from origin.
  - switch: Switch to a different branch. Requires branch name in args.
  - blame: Show who wrote each line of a file. Requires file path in args.
- args: Additional arguments for the operation.
  - For 'switch': Branch name to switch to (can be origin/branch-name for remote branches).
  - For 'blame': File path to blame.
  - For 'status', 'branch', 'fetch': No args needed.

Output: Returns the output of the git command.

Example usage:
- "git operation=status" - check current branch and status
- "git operation=branch" - list all branches
- "git operation=fetch" - fetch latest remote branches
- "git operation=switch args=origin/feature/my-branch" - switch to remote feature branch
- "git operation=blame args=src/index.ts" - see who wrote each line in index.ts`;

const GIT_TOOL_NAME = "git";

export const GIT_TOOL_PROMPT = `The ${GIT_TOOL_NAME} tool performs Git operations for repository exploration and context.

When to use:
- Check current branch and git status
- Switch to a different branch for comparison
- Use git blame to see who wrote each line of a file (useful for review context)

Parameters:
- operation: The git operation to perform.
  - status: Shows current branch, working tree status, and staged/unstaged changes.
  - switch: Switch to a different branch. Requires branch name in args.
  - blame: Show who wrote each line of a file. Requires file path in args.
- args: Additional arguments for the operation.
  - For 'switch': Branch name to switch to.
  - For 'blame': File path to blame.
  - For 'status': No args needed.

Output: Returns the output of the git command.

Example usage:
- "git operation=status" - check current branch and status
- "git operation=switch args=feature/my-branch" - switch to feature branch
- "git operation=blame args=src/index.ts" - see who wrote each line in index.ts

Note: For switch, use 'git switch' (modern) not 'git checkout' (legacy).`;

const LS_TOOL_NAME = "ls";

export const LS_TOOL_PROMPT = `The ${LS_TOOL_NAME} tool lists the contents of a directory.

When to use:
- Explore directory structure to understand the project layout
- Navigate to find specific files or subdirectories
- Verify existence of files or folders before attempting to read them

Parameters:
- path: The directory path to list (relative or absolute). If not provided, lists the current working directory.
- options (optional):
  - -l: Use a long listing format with details (permissions, owner, size, date)
  - -a: Show hidden files (files starting with .)
  - -R: List subdirectories recursively
  - -t: Sort by modification time (newest first)
  - -S: Sort by file size (largest first)
  - -d: List directories themselves, not their contents
  - -h: Human readable sizes (e.g., 1K, 2M)

Output: Returns a list of files and directories with optional details based on flags.

Example usage:
- "ls src" - list contents of src directory
- "ls -l src" - detailed list of src directory
- "ls -la" - show all files including hidden in current dir
- "ls -lt" - list sorted by modification time
- "ls -R" - recursive listing of all subdirectories`;

const GREP_TOOL_NAME = "grep";

export const GREP_TOOL_PROMPT = `The ${GREP_TOOL_NAME} tool searches for patterns in files using ripgrep.

When to use:
- Find all occurrences of a function, variable, or symbol across the codebase
- Search for usage patterns of a specific API or method
- Find all files that import or reference a particular module
- Search for specific strings or patterns in code

Parameters:
- query: The search pattern/query string to find in files.
- path (optional): Directory or file path to search in. Defaults to current directory.
- options (optional): Additional grep options:
  - -i: Case-insensitive search
  - -n: Show line numbers
  - -r: Search recursively in subdirectories
  - -w: Match whole word only
  - -C N: Show N lines of context around matches
  - -v: Invert match (show non-matching lines)
  - -l: Show only filenames with matches
  - -e: Enable extended regex
- maxResults (optional): Maximum number of matches to return (1-500).

Output: Returns matching lines with optional line numbers and context based on options.

Example usage:
- "grep useState src" - find all useState occurrences in src directory
- "grep -rn 'function' ." - recursive search with line numbers
- "grep -i 'error' . -C 2" - case-insensitive with 2 lines context
- "grep -l 'TODO' ." - list files containing TODO`;

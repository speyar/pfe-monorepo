const READFILE_TOOL_NAME = "readFile";

export const READFILE_TOOL_PROMPT = `The ${READFILE_TOOL_NAME} tool reads the contents of a file.

Default behavior policy:
- Prefer partial reads over full-file reads.
- When investigating code, pass lineStart/lineEnd or maxLines.
- Use grep/glob first to locate candidate lines/files, then read only the needed section.
- Full-file reads are allowed only for very small files or when range-based reading is not feasible.

When to use:
- Inspect the implementation of a specific file
- Read configuration files
- View source code to understand behavior
- Examine file contents before making decisions

Parameters:
- path: Path to the file to read (relative or absolute path from repository root).
- lineStart (optional): Starting line number (1-indexed). If not provided, reads from the beginning.
- lineEnd (optional): Ending line number (1-indexed). If not provided, reads to the end.
- maxLines (optional): Maximum number of lines to read. Useful for large files.
- options (optional): Additional cat options:
  - -n: Show line numbers
  - -b: Number only non-empty lines
  - -s: Squeeze multiple blank lines into one

Output: Returns the file contents, optionally with line numbers.

Example usage:
- "readFile src/index.ts" - read entire index.ts file
- "readFile src/app.ts lineStart=10 lineEnd=20" - read lines 10-20 of app.ts
- "readFile config.json" - read a config file
- "readFile src/main.ts maxLines=50" - read first 50 lines of main.ts`;

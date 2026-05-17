const EDITFILE_TOOL_NAME = "editFile";

export const EDITFILE_TOOL_PROMPT = `The ${EDITFILE_TOOL_NAME} tool makes targeted search-and-replace edits to a file.

When to use:
- Make a specific code change in a file (fix a bug, update a line, etc.)
- Change a function implementation while keeping the rest of the file intact
- Apply a targeted fix without rewriting the entire file

Parameters:
- path: Path to the file to edit (relative or absolute from repo root).
- search: The exact text to search for. Must match exactly and be unique (if multiple matches, the tool will reject).
- replace: The replacement text.

Output: Returns success or error message including how many matches were found.

IMPORTANT: The search text must be a unique, exact match in the file. Use readFile first to find the exact text.`;

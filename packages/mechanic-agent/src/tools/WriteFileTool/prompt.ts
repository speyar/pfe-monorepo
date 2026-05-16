const WRITEFILE_TOOL_NAME = "writeFile";

export const WRITEFILE_TOOL_PROMPT = `The ${WRITEFILE_TOOL_NAME} tool writes or overwrites a file with the given content.

When to use:
- Create a new file with specific content
- Overwrite an existing file completely
- Apply a fix that requires rewriting an entire file

Parameters:
- path: Path to the file to write (relative or absolute from repo root).
- content: The full content to write to the file. This will completely replace any existing content.

Output: Returns success or error message.

IMPORTANT: This tool overwrites the entire file. Use editFile for targeted changes.`;

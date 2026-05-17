const GLOB_TOOL_NAME = "glob";

export const GLOB_TOOL_PROMPT = `The ${GLOB_TOOL_NAME} tool finds files matching a specific pattern.

When to use:
- Discover all files of a certain type (e.g., all .ts files)
- Find files in specific directories or subdirectories
- Locate files matching a naming convention
- Explore project structure

Parameters:
- pattern: Glob pattern to match files (e.g., '*.ts', 'src/**/*.js', '**/*.json').
- path (optional): Directory path to search in. Defaults to current directory.
- type (optional): Filter by type:
  - 'f': Files only
  - 'd': Directories only
- maxResults (optional): Maximum number of results to return (1-500).

Output: Returns a list of file paths matching the pattern.

Example usage:
- "glob '*.ts'" - find all TypeScript files in current directory
- "glob 'src/**/*.js'" - find all JS files in src and subdirectories
- "glob '**/*.json' 'tests'" - find all JSON files in tests directory
- "glob '*.config.*' ." - find all config files (e.g., tsconfig.json, webpack.config.js)`;

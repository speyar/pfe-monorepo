import type { CopilotClientOptions } from "./copilot-client";

/**
 * Configuration for the GitHub Copilot AI SDK provider.
 */
export interface GitHubCopilotProviderOptions {
  /**
   * GitHub token for authentication.
   * Falls back to env vars: COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN
   */
  githubToken?: string;

  /**
   * Whether to use the logged-in user for authentication.
   * When true, the CLI server will attempt to use stored OAuth tokens.
   * @default true (false when githubToken is provided)
   */
  useLoggedInUser?: boolean;

  /**
   * Controls which built-in GitHub Copilot CLI tools are exposed to the model.
   *
   * - `"none"`: disable all built-in CLI tools (default)
   * - `"all"`: allow all built-in CLI tools
   * - `string[]`: allow only the listed built-in CLI tool names
   *
   * This does not affect external function tools passed through the AI SDK
   * (`options.tools` in `generateText` / `streamText`).
   */
  builtInTools?: "none" | "all" | string[];

  /**
   * Additional options forwarded to the CopilotClient constructor.
   */
  clientOptions?: Omit<
    CopilotClientOptions,
    "githubToken" | "useLoggedInUser" | "cliPath"
  >;

  /**
   * Explicit path to the Copilot CLI `index.js` file.
   *
   * When omitted, the provider auto-resolves the path from `@github/copilot`
   * using `import.meta.resolve`, which works because `@github/copilot` is a
   * direct dependency of this package.
   */
  cliPath?: string;

  /**
   * Default model to use when none is specified at the call site.
   * @default "gpt-4.1"
   */
  defaultModel?: string;

  /**
   * Timeout in milliseconds for sendAndWait calls.
   * @default 120_000 (2 minutes)
   */
  timeout?: number;
}

/**
 * Settings that can be passed per-model when calling the provider.
 */
export interface GitHubCopilotModelSettings {
  /**
   * Override the timeout for this specific model.
   */
  timeout?: number;

  /**
   * Per-model override for built-in CLI tool exposure.
   * Uses the same values as `GitHubCopilotProviderOptions.builtInTools`.
   */
  builtInTools?: "none" | "all" | string[];
}

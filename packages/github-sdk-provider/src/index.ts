// @ceira/github-sdk-provider — Vercel AI SDK provider for GitHub Copilot SDK
//
// Usage:
//   import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
//   const copilot = createGitHubCopilotProvider();
//   const { text } = await generateText({ model: copilot("gpt-4.1"), prompt: "Hello!" });

// Auth validation
export type { CopilotAuthStatus } from "./auth";
export { validateAuth } from "./auth";

// Error utilities
export type { CopilotErrorMetadata } from "./error";
export {
	createAPICallError,
	createAuthenticationError,
	createTimeoutError,
	getErrorMetadata,
	isAuthenticationError,
	isRetryableError,
	isTimeoutError,
	mapCopilotError,
} from "./error";

// Type exports
export type { CopilotModelInfo, GitHubCopilotProvider } from "./github-copilot-provider";

// Main export
export { createGitHubCopilotProvider } from "./github-copilot-provider";

export type {
	GitHubCopilotModelSettings,
	GitHubCopilotProviderOptions,
} from "./types";

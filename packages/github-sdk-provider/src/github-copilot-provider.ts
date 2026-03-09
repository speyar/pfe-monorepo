/**
 * Provider factory for the GitHub Copilot AI SDK provider.
 *
 * Creates a ProviderV3-compatible object that can be used with the Vercel AI SDK.
 * The returned provider is callable (returns a language model) and exposes
 * `.languageModel()`, `.chat()`, and `.listModels()` methods.
 */
import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import { NoSuchModelError } from "@ai-sdk/provider";
import { type CopilotAuthStatus, validateAuth } from "./auth";
import { CopilotClientManager } from "./client-manager";
import type { ModelInfo } from "./copilot-client";
import { GitHubCopilotLanguageModel } from "./github-copilot-language-model";
import type { GitHubCopilotModelSettings, GitHubCopilotProviderOptions } from "./types";

const DEFAULT_MODEL = "gpt-4.1";

/**
 * Re-export of the ModelInfo type for consumers.
 */
export type CopilotModelInfo = ModelInfo;

export interface GitHubCopilotProvider extends ProviderV3 {
	(modelId: string, settings?: GitHubCopilotModelSettings): LanguageModelV3;
	languageModel(modelId: string, settings?: GitHubCopilotModelSettings): LanguageModelV3;
	chat(modelId: string, settings?: GitHubCopilotModelSettings): LanguageModelV3;

	/**
	 * List available models from the Copilot backend.
	 * Returns the full ModelInfo array including capabilities, policy, and billing.
	 */
	listModels(): Promise<CopilotModelInfo[]>;

	/**
	 * Validate that the provider is properly authenticated.
	 * Initializes the Copilot client if needed and calls `getAuthStatus()`.
	 * Throws a `LoadAPIKeyError` with a helpful message on failure.
	 */
	validateAuth(): Promise<CopilotAuthStatus>;

	/**
	 * Stop the underlying CopilotClient and release resources.
	 * Call this when you're done using the provider (e.g. on server shutdown).
	 */
	cleanup(): Promise<void>;
}

/**
 * Create a GitHub Copilot provider for the Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
 * import { generateText } from "ai";
 *
 * const copilot = createGitHubCopilotProvider();
 *
 * const { text } = await generateText({
 *   model: copilot("gpt-4.1"),
 *   prompt: "Explain quantum computing in simple terms.",
 * });
 * ```
 */
export function createGitHubCopilotProvider(
	options: GitHubCopilotProviderOptions = {}
): GitHubCopilotProvider {
	const clientManager = new CopilotClientManager(options);

	const createLanguageModel = (
		modelId: string,
		settings?: GitHubCopilotModelSettings
	): LanguageModelV3 => {
		return new GitHubCopilotLanguageModel({
			modelId: modelId || options.defaultModel || DEFAULT_MODEL,
			clientManager,
			providerOptions: options,
			modelSettings: settings,
		});
	};

	const provider = Object.assign(
		function (modelId: string, settings?: GitHubCopilotModelSettings) {
			if (new.target) {
				throw new Error("The provider function cannot be called with the new keyword.");
			}
			return createLanguageModel(modelId, settings);
		},
		{
			specificationVersion: "v3" as const,

			languageModel: createLanguageModel,
			chat: createLanguageModel,

			embeddingModel: (modelId: string): never => {
				throw new NoSuchModelError({
					modelId,
					modelType: "embeddingModel",
					message: "GitHub Copilot provider does not support embedding models.",
				});
			},
			imageModel: (modelId: string): never => {
				throw new NoSuchModelError({
					modelId,
					modelType: "imageModel",
					message: "GitHub Copilot provider does not support image models.",
				});
			},

			listModels: async (): Promise<CopilotModelInfo[]> => {
				const client = await clientManager.getClient();
				return client.listModels();
			},

			validateAuth: async (): Promise<CopilotAuthStatus> => {
				const client = await clientManager.getClient();
				return validateAuth(client);
			},

			cleanup: () => clientManager.stop(),
		}
	) as GitHubCopilotProvider;

	return provider;
}

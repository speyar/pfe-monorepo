/**
 * Manages the CopilotClient lifecycle with lazy initialization and cleanup.
 *
 * Ensures we only create one client per provider instance and handle
 * cleanup properly. The CopilotClient resolves the CLI path via
 * `import.meta.resolve("@github/copilot/sdk")` which works because
 * `@github/copilot` is a direct dependency of this package.
 */
import { CopilotClient } from "./copilot-client";
import { mapCopilotError } from "./error";
import type { GitHubCopilotProviderOptions } from "./types";

export class CopilotClientManager {
	private client: CopilotClient | null = null;
	private initPromise: Promise<CopilotClient> | null = null;
	private readonly options: GitHubCopilotProviderOptions;

	constructor(options: GitHubCopilotProviderOptions) {
		this.options = options;
	}

	/**
	 * Get or create the CopilotClient. The client is lazily initialized
	 * on first use and cached for subsequent calls.
	 */
	async getClient(): Promise<CopilotClient> {
		if (this.client) {
			return this.client;
		}

		// Prevent concurrent initialization
		if (!this.initPromise) {
			this.initPromise = this.initialize();
		}

		return this.initPromise;
	}

	private async initialize(): Promise<CopilotClient> {
		try {
			const client = new CopilotClient({
				...this.options.clientOptions,
				githubToken: this.options.githubToken,
				useLoggedInUser: this.options.useLoggedInUser,
				cliPath: this.options.cliPath,
			});

			await client.start();
			this.client = client;
			return client;
		} catch (error) {
			// Reset so next call can retry
			this.initPromise = null;
			throw mapCopilotError(error);
		}
	}

	/**
	 * Stop the client and release resources.
	 */
	async stop(): Promise<void> {
		if (this.client) {
			try {
				await this.client.stop();
			} catch {
				// Best-effort cleanup — force stop if graceful fails
				await this.client.forceStop();
			}
			this.client = null;
			this.initPromise = null;
		}
	}
}

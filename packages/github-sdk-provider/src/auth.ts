/**
 * Authentication validation for the GitHub Copilot provider.
 *
 * Uses the CopilotClient's `getAuthStatus()` RPC call to verify that the
 * current authentication configuration is valid before making requests.
 */
import type { CopilotClient, GetAuthStatusResponse } from "./copilot-client";
import { createAuthenticationError } from "./error";

/**
 * Auth status returned by `validateAuth()`.
 */
export interface CopilotAuthStatus {
	/** Whether authentication is valid. */
	isAuthenticated: boolean;
	/** How the user is authenticated (token, OAuth, etc.). */
	authType?: string;
	/** GitHub host URL. */
	host?: string;
	/** Authenticated user login. */
	login?: string;
	/** Human-readable status message from the Copilot CLI. */
	statusMessage?: string;
}

/**
 * Validate that the Copilot client is properly authenticated.
 *
 * Calls `client.getAuthStatus()` to check the current auth state.
 * Throws a `LoadAPIKeyError` with a helpful message if authentication
 * is missing or invalid.
 *
 * @returns The auth status on success.
 * @throws LoadAPIKeyError if not authenticated.
 */
export async function validateAuth(client: CopilotClient): Promise<CopilotAuthStatus> {
	let status: GetAuthStatusResponse;

	try {
		status = await client.getAuthStatus();
	} catch (error) {
		throw createAuthenticationError({
			message: `Failed to check Copilot authentication status: ${error instanceof Error ? error.message : String(error)}. Ensure the Copilot CLI is running and accessible.`,
		});
	}

	if (!status.isAuthenticated) {
		const hint = buildAuthHint(status);
		throw createAuthenticationError({
			message: `GitHub Copilot authentication failed${status.statusMessage ? `: ${status.statusMessage}` : ""}. ${hint}`,
		});
	}

	return {
		isAuthenticated: status.isAuthenticated,
		authType: status.authType,
		host: status.host,
		login: status.login,
		statusMessage: status.statusMessage,
	};
}

/**
 * Build a human-readable hint about how to authenticate.
 */
function buildAuthHint(_status: GetAuthStatusResponse): string {
	const suggestions = [
		"Set one of: COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variables",
		"Or pass `githubToken` in provider options",
		"Or log in with `gh auth login` for OAuth-based auth",
	];

	return suggestions.join(". ");
}

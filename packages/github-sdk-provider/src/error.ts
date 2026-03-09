/**
 * Error mapping utilities for the GitHub Copilot SDK provider.
 *
 * Maps Copilot SDK errors to @ai-sdk/provider error types so the AI SDK
 * can handle retries, user-facing messages, etc. appropriately.
 */
import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";

// URL used in APICallError to identify the source of the error.
const COPILOT_SDK_URL = "copilot-sdk://cli-server";

/**
 * Metadata attached to Copilot provider errors for diagnostic purposes.
 */
export interface CopilotErrorMetadata {
	code?: string;
	originalMessage?: string;
}

// ---------------------------------------------------------------------------
// Error factory functions
// ---------------------------------------------------------------------------

/**
 * Create an APICallError with Copilot-specific metadata.
 */
export function createAPICallError({
	message,
	code,
	isRetryable = false,
	statusCode = 500,
}: {
	message: string;
	code?: string;
	isRetryable?: boolean;
	statusCode?: number;
}): APICallError {
	return new APICallError({
		url: COPILOT_SDK_URL,
		requestBodyValues: {},
		statusCode,
		message,
		isRetryable,
		data: { code } satisfies CopilotErrorMetadata,
	});
}

/**
 * Create an authentication error (e.g. missing or invalid GitHub token).
 */
export function createAuthenticationError({ message }: { message: string }): LoadAPIKeyError {
	return new LoadAPIKeyError({ message });
}

/**
 * Create a timeout error (retryable, HTTP 504).
 */
export function createTimeoutError({ message }: { message: string }): APICallError {
	return createAPICallError({
		message,
		code: "TIMEOUT",
		isRetryable: true,
		statusCode: 504,
	});
}

// ---------------------------------------------------------------------------
// Error detection utilities
// ---------------------------------------------------------------------------

/**
 * Check if an error is an authentication error.
 */
export function isAuthenticationError(error: unknown): boolean {
	if (LoadAPIKeyError.isInstance(error)) return true;

	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes("unauthorized") ||
			msg.includes("authentication") ||
			msg.includes("not authenticated") ||
			msg.includes("api key") ||
			msg.includes("credentials") ||
			msg.includes("token")
		);
	}

	return false;
}

/**
 * Check if an error is a timeout error.
 */
export function isTimeoutError(error: unknown): boolean {
	if (APICallError.isInstance(error)) {
		return (
			error.statusCode === 504 ||
			(error.data as CopilotErrorMetadata | undefined)?.code === "TIMEOUT"
		);
	}

	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return msg.includes("timeout") || msg.includes("timed out");
	}

	return false;
}

/**
 * Check if an error is retryable (transient network / process issues).
 */
export function isRetryableError(error: unknown): boolean {
	if (APICallError.isInstance(error)) return error.isRetryable;

	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes("timeout") ||
			msg.includes("econnreset") ||
			msg.includes("econnrefused") ||
			msg.includes("socket hang up") ||
			msg.includes("cli server exited") ||
			msg.includes("rate limit")
		);
	}

	return false;
}

/**
 * Extract Copilot error metadata from an APICallError.
 */
export function getErrorMetadata(error: unknown): CopilotErrorMetadata | undefined {
	if (APICallError.isInstance(error)) {
		return error.data as CopilotErrorMetadata;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Map an unknown Copilot SDK error to the appropriate AI SDK error type.
 *
 * Abort errors are re-thrown unmodified so the AI SDK's cancellation
 * logic works correctly. All other errors are categorised by their
 * message content and turned into structured AISDKError subtypes.
 */
export function mapCopilotError(error: unknown): APICallError | LoadAPIKeyError {
	if (error instanceof Error) {
		// Abort errors must pass through unchanged
		if (error.name === "AbortError") {
			throw error;
		}

		const msg = error.message.toLowerCase();

		// Authentication errors
		if (isAuthenticationError(error)) {
			return createAuthenticationError({ message: error.message });
		}

		// Rate limit errors
		if (msg.includes("rate limit") || msg.includes("quota")) {
			return createAPICallError({
				message: error.message,
				code: "RATE_LIMIT",
				isRetryable: true,
				statusCode: 429,
			});
		}

		// Timeout errors
		if (isTimeoutError(error)) {
			return createTimeoutError({ message: error.message });
		}

		// Model not found
		if (
			msg.includes("not found") ||
			msg.includes("no such model") ||
			(msg.includes("model") && msg.includes("invalid"))
		) {
			return createAPICallError({
				message: error.message,
				code: "MODEL_NOT_FOUND",
				isRetryable: false,
				statusCode: 404,
			});
		}

		// Invalid request
		if (msg.includes("invalid") || msg.includes("bad request")) {
			return createAPICallError({
				message: error.message,
				code: "INVALID_REQUEST",
				isRetryable: false,
				statusCode: 400,
			});
		}

		// CLI process errors (likely transient)
		if (msg.includes("cli server exited") || msg.includes("econnrefused")) {
			return createAPICallError({
				message: error.message,
				code: "CLI_PROCESS_ERROR",
				isRetryable: true,
				statusCode: 502,
			});
		}

		// Default: internal server error
		return createAPICallError({
			message: error.message,
			code: "INTERNAL_ERROR",
			isRetryable: true,
			statusCode: 500,
		});
	}

	// Unknown error type
	return createAPICallError({
		message: `An unknown error occurred: ${String(error)}`,
		code: "UNKNOWN_ERROR",
		isRetryable: true,
		statusCode: 500,
	});
}

/**
 * @deprecated Use `mapCopilotError` for structured AI SDK errors instead.
 * Wrap an unknown error into a standard Error instance with context.
 */
export function wrapError(error: unknown, context: string): Error {
	if (error instanceof Error) {
		const wrapped = new Error(`${context}: ${error.message}`);
		wrapped.stack = error.stack;
		return wrapped;
	}
	return new Error(`${context}: ${String(error)}`);
}

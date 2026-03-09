/**
 * Custom CopilotClient — replaces `@github/copilot-sdk`'s CopilotClient.
 *
 * Spawns the `@github/copilot` CLI as a child process, communicates via
 * JSON-RPC over stdio, and provides the methods our provider uses:
 *   start(), stop(), forceStop(), createSession(), listModels(), getAuthStatus()
 *
 * The CLI path is resolved by searching node_modules directories for
 * `@github/copilot/index.js`. This avoids `import.meta.resolve` which
 * gets mangled by Turbopack when bundling workspace packages.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
	createMessageConnection,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { CopilotSession } from "./copilot-session.js";

// ── Constants ────────────────────────────────────────────────────────

const SDK_PROTOCOL_VERSION = 2;

// ── Types ────────────────────────────────────────────────────────────

export interface CopilotClientOptions {
	/** GitHub personal access token or Copilot token. */
	githubToken?: string;
	/** Use the logged-in user's credentials (via `gh auth`). Defaults to true when no token. */
	useLoggedInUser?: boolean;
	/** Explicit path to the Copilot CLI `index.js`. Auto-resolved if omitted. */
	cliPath?: string;
	/** Working directory for the CLI process. */
	cwd?: string;
	/** Log level for the CLI. */
	logLevel?: string;
	/** Extra CLI arguments. */
	cliArgs?: string[];
}

export interface CreateSessionConfig {
	model?: string;
	streaming?: boolean;
	systemMessage?: { mode: string; content: string };
	tools?: CopilotTool[];
}

export interface CopilotTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
	handler?: (
		args: unknown,
		invocation: unknown
	) => Promise<{ textResultForLlm: string; resultType: string }>;
}

export interface ModelInfo {
	id: string;
	name?: string;
	version?: string;
	capabilities?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface GetAuthStatusResponse {
	isAuthenticated: boolean;
	authType?: string;
	host?: string;
	login?: string;
	statusMessage?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getNodeExecPath(): string {
	// Bun doesn't work with Node child processes the same way
	if ((process as unknown as { versions: { bun?: string } }).versions.bun) {
		return "node";
	}
	return process.execPath;
}

/**
 * Resolve the path to the Copilot CLI entry point (`@github/copilot/index.js`).
 *
 * We cannot use `import.meta.resolve` because Turbopack mangles it when
 * bundling workspace packages (even if listed in serverExternalPackages).
 * We cannot use `require.resolve("@github/copilot")` because the package
 * has strict ESM-only exports that block CJS resolution.
 *
 * Strategy (in order):
 * 1. Standard Node module search paths from process.cwd()
 * 2. Walk up from process.cwd() checking node_modules at each level
 * 3. Scan workspace package directories (packages/*, apps/*) for their
 *    node_modules/@github/copilot — handles pnpm strict isolation where
 *    the dependency is only in the provider package's node_modules
 * 4. Scan the pnpm virtual store (.pnpm) for the real package location
 */
function resolveBundledCliPath(): string {
	const target = join("@github", "copilot", "index.js");
	const debug = process.env.COPILOT_CLI_DEBUG === "1";
	const logPrefix = "[copilot-cli-resolve]";
	const log = (...args: unknown[]) => {
		if (!debug) return;
		console.log(logPrefix, ...args);
	};
	const listDir = (dirPath: string) => {
		if (!debug) return;
		try {
			const entries = readdirSync(dirPath, { withFileTypes: true }).map((entry) =>
				entry.isDirectory() || entry.isSymbolicLink() ? `${entry.name}/` : entry.name
			);
			log("dir", dirPath, { count: entries.length, entries });
		} catch (error) {
			log("dir-error", dirPath, error instanceof Error ? error.message : String(error));
		}
	};

	log("start", { cwd: process.cwd() });
	listDir(process.cwd());
	listDir(join(process.cwd(), "node_modules"));

	// Strategy 1: Standard node_modules search paths from cwd
	try {
		const require_ = createRequire(join(process.cwd(), "_"));
		const searchPaths = require_.resolve.paths("@github/copilot") ?? [];
		log("strategy-1", { searchPathsCount: searchPaths.length });
		for (const searchPath of searchPaths) {
			const candidate = join(searchPath, target);
			log("strategy-1-check", candidate);
			if (existsSync(candidate)) {
				log("strategy-1-hit", candidate);
				return realpathSync(candidate);
			}
		}
	} catch {
		// createRequire can fail in some bundler environments — continue
		log("strategy-1-error");
	}

	// Strategy 2: Walk up from cwd checking node_modules at each level
	let dir = process.cwd();
	for (;;) {
		const candidate = join(dir, "node_modules", target);
		log("strategy-2-check", candidate);
		if (existsSync(candidate)) {
			log("strategy-2-hit", candidate);
			return realpathSync(candidate);
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	// Strategy 3: Scan workspace package directories
	// In a pnpm monorepo, @github/copilot may only exist in the provider
	// package's node_modules, not hoisted to root. Scan packages/* and apps/*
	// directories for any node_modules/@github/copilot.
	const monorepoRoot = findMonorepoRoot(process.cwd());
	log("monorepo-root", monorepoRoot);
	if (monorepoRoot) {
		listDir(monorepoRoot);
		listDir(join(monorepoRoot, "node_modules"));
		for (const wsDir of ["packages", "apps"]) {
			const wsRoot = join(monorepoRoot, wsDir);
			if (!existsSync(wsRoot)) continue;
			try {
				log("strategy-3-scan", wsRoot);
				listDir(wsRoot);
				for (const entry of readdirSync(wsRoot, { withFileTypes: true })) {
					if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
					const candidate = join(wsRoot, entry.name, "node_modules", target);
					listDir(join(wsRoot, entry.name));
					listDir(join(wsRoot, entry.name, "node_modules"));
					log("strategy-3-check", candidate);
					if (existsSync(candidate)) {
						log("strategy-3-hit", candidate);
						return realpathSync(candidate);
					}
				}
			} catch {
				// Permission denied or similar — skip
				log("strategy-3-error", wsRoot);
			}
		}

		// Strategy 4: Search the pnpm virtual store
		const pnpmStore = join(monorepoRoot, "node_modules", ".pnpm");
		if (existsSync(pnpmStore)) {
			try {
				log("strategy-4-scan", pnpmStore);
				listDir(pnpmStore);
				for (const entry of readdirSync(pnpmStore, { withFileTypes: true })) {
					if (!entry.name.startsWith("@github+copilot@")) continue;
					const candidate = join(
						pnpmStore,
						entry.name,
						"node_modules",
						"@github",
						"copilot",
						"index.js"
					);
					listDir(join(pnpmStore, entry.name));
					listDir(join(pnpmStore, entry.name, "node_modules"));
					listDir(join(pnpmStore, entry.name, "node_modules", "@github"));
					log("strategy-4-check", candidate);
					if (existsSync(candidate)) {
						log("strategy-4-hit", candidate);
						return realpathSync(candidate);
					}
				}
			} catch {
				// Permission denied or similar — skip
				log("strategy-4-error", pnpmStore);
			}
		}
	}

	log("not-found", { cwd: process.cwd() });
	throw new Error(
		"Could not find @github/copilot CLI (index.js). " +
			"Ensure @github/copilot is installed as a dependency. " +
			`Searched from: ${process.cwd()}`
	);
}

/** Walk up from a directory to find a monorepo root (has pnpm-workspace.yaml or package.json with workspaces). */
function findMonorepoRoot(from: string): string | null {
	let current = from;
	for (;;) {
		if (
			existsSync(join(current, "pnpm-workspace.yaml")) ||
			existsSync(join(current, "pnpm-lock.yaml"))
		) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

// ── Client class ─────────────────────────────────────────────────────

export class CopilotClient {
	private cliProcess: ChildProcess | null = null;
	private connection: MessageConnection | null = null;
	private state: "disconnected" | "connecting" | "connected" | "error" = "disconnected";
	private sessions = new Map<string, CopilotSession>();
	private stderrBuffer = "";
	private readonly options: Required<
		Pick<CopilotClientOptions, "cliPath" | "cwd" | "logLevel" | "cliArgs">
	> &
		CopilotClientOptions;
	private forceStopping = false;
	private modelsCache: ModelInfo[] | null = null;
	private processExitPromise: Promise<never> | null = null;

	constructor(opts: CopilotClientOptions = {}) {
		this.options = {
			cliPath: opts.cliPath ?? resolveBundledCliPath(),
			cwd: opts.cwd ?? process.cwd(),
			logLevel: opts.logLevel ?? "debug",
			cliArgs: opts.cliArgs ?? [],
			githubToken: opts.githubToken,
			useLoggedInUser: opts.useLoggedInUser ?? !opts.githubToken,
		};
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	async start(): Promise<void> {
		if (this.state === "connected") return;
		this.state = "connecting";
		try {
			await this.startCLIServer();
			await this.connectViaStdio();
			await this.verifyProtocolVersion();
			this.state = "connected";
		} catch (error) {
			this.state = "error";
			throw error;
		}
	}

	async stop(): Promise<Error[]> {
		const errors: Error[] = [];

		// Destroy all sessions with retries
		for (const session of this.sessions.values()) {
			const sid = session.sessionId;
			let lastError: Error | null = null;
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					await session.destroy();
					lastError = null;
					break;
				} catch (err) {
					lastError = err instanceof Error ? err : new Error(String(err));
					if (attempt < 3) {
						await new Promise((r) => setTimeout(r, 100 * 2 ** (attempt - 1)));
					}
				}
			}
			if (lastError) {
				errors.push(
					new Error(`Failed to destroy session ${sid} after 3 attempts: ${lastError.message}`)
				);
			}
		}
		this.sessions.clear();

		if (this.connection) {
			try {
				this.connection.dispose();
			} catch (err) {
				errors.push(
					new Error(
						`Failed to dispose connection: ${err instanceof Error ? err.message : String(err)}`
					)
				);
			}
			this.connection = null;
		}

		this.modelsCache = null;

		if (this.cliProcess) {
			try {
				this.cliProcess.kill();
			} catch (err) {
				errors.push(
					new Error(
						`Failed to kill CLI process: ${err instanceof Error ? err.message : String(err)}`
					)
				);
			}
			this.cliProcess = null;
		}

		this.state = "disconnected";
		this.stderrBuffer = "";
		this.processExitPromise = null;
		return errors;
	}

	async forceStop(): Promise<void> {
		this.forceStopping = true;
		this.sessions.clear();

		if (this.connection) {
			try {
				this.connection.dispose();
			} catch {
				/* swallow */
			}
			this.connection = null;
		}
		this.modelsCache = null;

		if (this.cliProcess) {
			try {
				this.cliProcess.kill("SIGKILL");
			} catch {
				/* swallow */
			}
			this.cliProcess = null;
		}

		this.state = "disconnected";
		this.stderrBuffer = "";
		this.processExitPromise = null;
	}

	// ── Session management ───────────────────────────────────────────

	async createSession(config: CreateSessionConfig = {}): Promise<CopilotSession> {
		if (!this.connection) {
			throw new Error("Client not connected. Call start() first.");
		}

		const response = (await this.connection.sendRequest("session.create", {
			model: config.model,
			streaming: config.streaming,
			systemMessage: config.systemMessage,
			tools: config.tools?.map((t) => ({
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			})),
			requestPermission: true,
		})) as { sessionId: string; workspacePath?: string };

		const session = new CopilotSession(response.sessionId, this.connection);
		this.sessions.set(response.sessionId, session);
		return session;
	}

	// ── Model listing ────────────────────────────────────────────────

	async listModels(): Promise<ModelInfo[]> {
		if (!this.connection) {
			throw new Error("Client not connected. Call start() first.");
		}

		if (this.modelsCache !== null) {
			return [...this.modelsCache];
		}

		const result = (await this.connection.sendRequest("models.list", {})) as {
			models: ModelInfo[];
		};
		this.modelsCache = result.models;
		return [...result.models];
	}

	// ── Auth status ──────────────────────────────────────────────────

	async getAuthStatus(): Promise<GetAuthStatusResponse> {
		if (!this.connection) {
			throw new Error("Client not connected. Call start() first.");
		}

		return (await this.connection.sendRequest("auth.getStatus", {})) as GetAuthStatusResponse;
	}

	// ── Private: spawn CLI ───────────────────────────────────────────

	private startCLIServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.stderrBuffer = "";

			const args: string[] = [
				...this.options.cliArgs,
				"--headless",
				"--no-auto-update",
				"--log-level",
				this.options.logLevel,
				"--stdio",
			];

			if (this.options.githubToken) {
				args.push("--auth-token-env", "COPILOT_SDK_AUTH_TOKEN");
			}
			if (!this.options.useLoggedInUser) {
				args.push("--no-auto-login");
			}

			const env: Record<string, string | undefined> = {
				...process.env,
			};
			// Remove NODE_DEBUG which can interfere with JSON-RPC
			delete env.NODE_DEBUG;

			if (this.options.githubToken) {
				env.COPILOT_SDK_AUTH_TOKEN = this.options.githubToken;
			}

			if (!existsSync(this.options.cliPath)) {
				reject(
					new Error(
						`Copilot CLI not found at ${this.options.cliPath}. Ensure @github/copilot is installed.`
					)
				);
				return;
			}

			const isJs = this.options.cliPath.endsWith(".js");
			if (isJs) {
				this.cliProcess = spawn(getNodeExecPath(), [this.options.cliPath, ...args], {
					stdio: ["pipe", "pipe", "pipe"],
					cwd: this.options.cwd,
					env: env as NodeJS.ProcessEnv,
					windowsHide: true,
				});
			} else {
				this.cliProcess = spawn(this.options.cliPath, args, {
					stdio: ["pipe", "pipe", "pipe"],
					cwd: this.options.cwd,
					env: env as NodeJS.ProcessEnv,
					windowsHide: true,
				});
			}

			// For stdio mode, resolve immediately — the connection setup happens next.
			let resolved = false;
			resolved = true;
			resolve();

			this.cliProcess.stderr?.on("data", (data: Buffer) => {
				this.stderrBuffer += data.toString();
				const lines = data.toString().split("\n");
				for (const line of lines) {
					if (line.trim()) {
						process.stderr.write(`[CLI subprocess] ${line}\n`);
					}
				}
			});

			this.cliProcess.on("error", (error: Error) => {
				if (!resolved) {
					resolved = true;
					const stderr = this.stderrBuffer.trim();
					reject(
						new Error(
							`Failed to start CLI server: ${error.message}${stderr ? `\nstderr: ${stderr}` : ""}`
						)
					);
				}
			});

			this.processExitPromise = new Promise<never>((_, rejectExit) => {
				this.cliProcess?.on("exit", (code: number | null) => {
					setTimeout(() => {
						const stderr = this.stderrBuffer.trim();
						rejectExit(
							new Error(`CLI server exited with code ${code}${stderr ? `\nstderr: ${stderr}` : ""}`)
						);
					}, 50);
				});
			});
			// Prevent unhandled rejection
			this.processExitPromise.catch(() => {});

			this.cliProcess.on("exit", (code: number | null) => {
				if (!resolved) {
					resolved = true;
					const stderr = this.stderrBuffer.trim();
					reject(
						new Error(`CLI server exited with code ${code}${stderr ? `\nstderr: ${stderr}` : ""}`)
					);
				}
			});

			setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new Error("Timeout waiting for CLI server to start"));
				}
			}, 10_000);
		});
	}

	// ── Private: connect JSON-RPC over stdio ─────────────────────────

	private async connectViaStdio(): Promise<void> {
		if (!this.cliProcess) {
			throw new Error("CLI process not started");
		}
		if (!this.cliProcess.stdout || !this.cliProcess.stdin) {
			throw new Error("CLI process stdio not available");
		}

		this.cliProcess.stdin?.on("error", (err: Error) => {
			if (!this.forceStopping) {
				// Log but don't throw — the connection error handler will deal with it
				process.stderr.write(`[CLI stdin error] ${err.message}\n`);
			}
		});

		this.connection = createMessageConnection(
			new StreamMessageReader(this.cliProcess.stdout),
			new StreamMessageWriter(this.cliProcess.stdin)
		);

		this.attachConnectionHandlers();
		this.connection.listen();
	}

	// ── Private: verify protocol version ─────────────────────────────

	private async verifyProtocolVersion(): Promise<void> {
		if (!this.connection) throw new Error("No connection");

		const ping = this.connection.sendRequest("ping", {}) as Promise<{
			message?: string;
			timestamp?: number;
			protocolVersion?: number;
		}>;

		const result = this.processExitPromise
			? await Promise.race([ping, this.processExitPromise])
			: await ping;

		if (result.protocolVersion === undefined) {
			throw new Error(
				`SDK protocol version mismatch: SDK expects version ${SDK_PROTOCOL_VERSION}, but server does not report a protocol version.`
			);
		}
		if (result.protocolVersion !== SDK_PROTOCOL_VERSION) {
			throw new Error(
				`SDK protocol version mismatch: SDK expects version ${SDK_PROTOCOL_VERSION}, but server reports version ${result.protocolVersion}.`
			);
		}
	}

	// ── Private: JSON-RPC notification / request handlers ────────────

	private attachConnectionHandlers(): void {
		if (!this.connection) return;

		// Server → Client notifications
		this.connection.onNotification("session.event", (notification: unknown) => {
			this.handleSessionEvent(notification);
		});

		this.connection.onNotification("session.lifecycle", (_notification: unknown) => {
			// We don't use lifecycle events in our provider — no-op
		});

		// Server → Client requests (we must respond)
		this.connection.onRequest(
			"tool.call",
			async (params: {
				sessionId: string;
				toolCallId: string;
				toolName: string;
				arguments: unknown;
			}) => {
				// Our provider uses AI SDK's tool execution model — the Copilot SDK
				// tools have no-op handlers. We just return "unsupported".
				return {
					result: {
						textResultForLlm: `Tool '${params.toolName}' is not supported by this client instance.`,
						resultType: "failure",
						error: `tool '${params.toolName}' not supported`,
						toolTelemetry: {},
					},
				};
			}
		);

		this.connection.onRequest("permission.request", async (_params: unknown) => {
			// Auto-deny all permission requests
			return {
				result: {
					kind: "denied-no-approval-rule-and-could-not-request-from-user",
				},
			};
		});

		this.connection.onRequest("userInput.request", async (_params: unknown) => {
			throw new Error("User input requested but no handler registered");
		});

		this.connection.onRequest("hooks.invoke", async (_params: unknown) => {
			return { output: undefined };
		});

		this.connection.onClose(() => {
			// No auto-reconnect in our implementation — serverless doesn't need it
		});

		this.connection.onError((_error) => {
			// Swallow — errors will surface through request rejections
		});
	}

	private handleSessionEvent(notification: unknown): void {
		if (
			typeof notification !== "object" ||
			!notification ||
			!("sessionId" in notification) ||
			typeof (notification as { sessionId: unknown }).sessionId !== "string" ||
			!("event" in notification)
		) {
			return;
		}

		const { sessionId, event } = notification as {
			sessionId: string;
			event: { type: string; data?: unknown };
		};
		const session = this.sessions.get(sessionId);
		if (session) {
			session._dispatchEvent(event);
		}
	}
}

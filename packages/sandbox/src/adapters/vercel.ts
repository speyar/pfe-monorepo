import { APIError, Sandbox } from "@vercel/sandbox";

import type {
  CreateSandboxInput,
  ExtendTimeoutInput,
  ListSandboxesInput,
  ManagedSandbox,
  RunSandboxCommandInput,
  RunSandboxCommandResult,
  SandboxLifecycleState,
} from "../contracts";
import {
  AuthError,
  ConfigError,
  NotFoundError,
  RateLimitError,
  SandboxError,
  TimeoutError,
} from "../errors";
import type { SandboxProvider } from "../provider";

type VercelCredentials = {
  token: string;
  projectId: string;
  teamId: string;
};

export interface VercelSandboxProviderOptions {
  credentials?: Partial<VercelCredentials>;
  defaultRuntime?: string;
}

type VercelSandboxStatus =
  | "aborted"
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "snapshotting";

export class VercelSandboxProvider implements SandboxProvider {
  public readonly name = "vercel";
  private readonly defaultRuntime: string;
  private readonly credentials?: VercelCredentials;

  constructor(options: VercelSandboxProviderOptions = {}) {
    this.defaultRuntime = options.defaultRuntime ?? "node24";
    this.credentials = resolveCredentials(options.credentials);
  }

  public async createSandbox(
    input: CreateSandboxInput,
  ): Promise<ManagedSandbox> {
    try {
      const sandbox = await Sandbox.create({
        ...this.credentials,
        runtime: input.runtime ?? this.defaultRuntime,
        timeout:
          typeof input.timeoutSeconds === "number"
            ? input.timeoutSeconds * 1000
            : undefined,
        resources:
          typeof input.resourceProfile?.vcpus === "number"
            ? { vcpus: input.resourceProfile.vcpus }
            : undefined,
        source: {
          type: "git",
          url: input.source.url,
          username: input.source.username,
          password: input.source.password,
        },
      });

      return mapLiveSandbox(sandbox, {
        ownerId: input.ownerId,
        metadata: input.metadata,
      });
    } catch (error) {
      throw mapVercelError(error, "create sandbox");
    }
  }

  public async getSandbox(sandboxId: string): Promise<ManagedSandbox | null> {
    try {
      const sandbox = await Sandbox.get({
        ...this.credentials,
        sandboxId,
      });

      return mapLiveSandbox(sandbox);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw mapVercelError(error, "get sandbox");
    }
  }

  public async listSandboxes(
    input?: ListSandboxesInput,
  ): Promise<ManagedSandbox[]> {
    try {
      const response = await Sandbox.list({
        ...this.credentials,
        limit: input?.limit,
      });

      const mapped = response.json.sandboxes.map((sandbox) =>
        mapSandboxSummary(sandbox),
      );

      if (!input?.states?.length) {
        return mapped;
      }

      return mapped.filter((sandbox) => input.states?.includes(sandbox.state));
    } catch (error) {
      throw mapVercelError(error, "list sandboxes");
    }
  }

  public async stopSandbox(sandboxId: string): Promise<ManagedSandbox> {
    try {
      const sandbox = await Sandbox.get({
        ...this.credentials,
        sandboxId,
      });
      await sandbox.stop();

      const stoppedSandbox = await Sandbox.get({
        ...this.credentials,
        sandboxId,
      });
      return mapLiveSandbox(stoppedSandbox);
    } catch (error) {
      throw mapVercelError(error, "stop sandbox");
    }
  }

  public async extendTimeout(
    input: ExtendTimeoutInput,
  ): Promise<ManagedSandbox> {
    try {
      const sandbox = await Sandbox.get({
        ...this.credentials,
        sandboxId: input.sandboxId,
      });

      await sandbox.extendTimeout(input.timeoutSeconds * 1000);
      const refreshed = await Sandbox.get({
        ...this.credentials,
        sandboxId: input.sandboxId,
      });
      return mapLiveSandbox(refreshed);
    } catch (error) {
      throw mapVercelError(error, "extend sandbox timeout");
    }
  }

  public async runCommand(
    input: RunSandboxCommandInput,
  ): Promise<RunSandboxCommandResult> {
    try {
      const sandbox = await Sandbox.get({
        ...this.credentials,
        sandboxId: input.sandboxId,
      });

      if (input.detached) {
        throw new ConfigError(
          "Detached command mode is not supported by the current provider contract.",
        );
      }

      const command = await sandbox.runCommand({
        cmd: input.command,
        cwd: input.cwd,
        args: input.args,
        signal:
          typeof input.timeoutMs === "number"
            ? AbortSignal.timeout(input.timeoutMs)
            : undefined,
      });

      return {
        stdout: await command.stdout(),
        stderr: await command.stderr(),
        exitCode: command.exitCode,
      };
    } catch (error) {
      throw mapVercelError(error, "run sandbox command");
    }
  }
}

function resolveCredentials(
  credentials?: Partial<VercelCredentials>,
): VercelCredentials | undefined {
  const token = credentials?.token ?? getEnv("VERCEL_TOKEN");
  const projectId = credentials?.projectId ?? getEnv("VERCEL_PROJECT_ID");
  const teamId = credentials?.teamId ?? getEnv("VERCEL_TEAM_ID");

  if (!token && !projectId && !teamId) {
    return undefined;
  }

  if (!token || !projectId || !teamId) {
    throw new ConfigError(
      "Incomplete Vercel credentials. Provide token, projectId, and teamId together or rely on VERCEL_OIDC_TOKEN.",
    );
  }

  return { token, projectId, teamId };
}

// TODO: we'll later have a unified way to access ENV variables, remember to edit this later
function getEnv(name: string): string | undefined {
  const maybeProcess = globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return maybeProcess.process?.env?.[name];
}

function mapLiveSandbox(
  sandbox: Sandbox,
  overrides: { ownerId?: string; metadata?: Record<string, unknown> } = {},
): ManagedSandbox {
  const now = new Date();
  const timeoutMs = sandbox.timeout;

  return {
    id: sandbox.sandboxId,
    provider: "vercel",
    state: mapSandboxState(sandbox.status),
    createdAt: sandbox.createdAt,
    updatedAt: now,
    ownerId: overrides.ownerId,
    expiresAt:
      typeof timeoutMs === "number" && timeoutMs > 0
        ? new Date(Date.now() + timeoutMs)
        : undefined,
    metadata: {
      ...(overrides.metadata ?? {}),
      runtime: "unknown",
      timeoutMs,
      interactivePort: sandbox.interactivePort,
      sourceSnapshotId: sandbox.sourceSnapshotId,
      networkPolicy: sandbox.networkPolicy,
    },
  };
}

function mapSandboxSummary(sandbox: {
  id: string;
  status: VercelSandboxStatus;
  createdAt: number;
  updatedAt: number;
  runtime: string;
  timeout: number;
  sourceSnapshotId?: string;
  interactivePort?: number;
  networkPolicy?: unknown;
}): ManagedSandbox {
  return {
    id: sandbox.id,
    provider: "vercel",
    state: mapSandboxState(sandbox.status),
    createdAt: new Date(sandbox.createdAt),
    updatedAt: new Date(sandbox.updatedAt),
    expiresAt:
      typeof sandbox.timeout === "number" && sandbox.timeout > 0
        ? new Date(Date.now() + sandbox.timeout)
        : undefined,
    metadata: {
      runtime: sandbox.runtime,
      timeoutMs: sandbox.timeout,
      sourceSnapshotId: sandbox.sourceSnapshotId,
      interactivePort: sandbox.interactivePort,
      networkPolicy: sandbox.networkPolicy,
    },
  };
}

function mapSandboxState(state: VercelSandboxStatus): SandboxLifecycleState {
  switch (state) {
    case "pending":
    case "running":
    case "stopping":
    case "stopped":
    case "failed":
      return state;
    case "aborted":
      return "stopped";
    case "snapshotting":
      return "running";
    default:
      return "unknown";
  }
}

function mapVercelError(error: unknown, operation: string): Error {
  if (error instanceof SandboxError) {
    return error;
  }

  if (error instanceof APIError) {
    const status = error.response.status;
    if (status === 401 || status === 403) {
      return new AuthError(
        `Unauthorized to ${operation} in Vercel Sandbox.`,
        error,
      );
    }

    if (status === 404) {
      return new NotFoundError(
        `Sandbox resource not found while trying to ${operation}.`,
        error,
      );
    }

    if (status === 408 || status === 504) {
      return new TimeoutError(`Timeout while trying to ${operation}.`, error);
    }

    if (status === 429) {
      return new RateLimitError(
        `Rate limited while trying to ${operation}.`,
        error,
      );
    }

    const apiError = error as APIError<unknown>;
    const bodyText =
      typeof apiError.text === "string" ? apiError.text : undefined;
    const bodyJson =
      apiError.json && typeof apiError.json === "object"
        ? JSON.stringify(apiError.json)
        : undefined;
    const bodyDetail = bodyJson ?? bodyText;

    return new SandboxError(
      `Vercel API error while trying to ${operation}: ${error.message}${bodyDetail ? ` | body=${bodyDetail}` : ""}`,
      "VERCEL_API_ERROR",
      error,
    );
  }

  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return new TimeoutError(`Timeout while trying to ${operation}.`, error);
    }

    const message = error.message.toLowerCase();
    if (message.indexOf("oidc") >= 0 || message.indexOf("token") >= 0) {
      return new AuthError(
        `Authentication error while trying to ${operation}.`,
        error,
      );
    }

    return new SandboxError(
      `Unexpected Vercel Sandbox error while trying to ${operation}: ${error.message}`,
      "VERCEL_ADAPTER_ERROR",
      error,
    );
  }

  return new SandboxError(
    `Unknown Vercel Sandbox failure while trying to ${operation}.`,
    "VERCEL_UNKNOWN_ERROR",
    error,
  );
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false;
  }

  return error.response.status === 404;
}

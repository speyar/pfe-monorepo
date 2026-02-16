export type SandboxLifecycleState =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "unknown";

export const ACTIVE_SANDBOX_STATES: readonly SandboxLifecycleState[] = [
  "pending",
  "running",
  "stopping",
];

export interface SandboxMetadata {
  [key: string]: unknown;
}

export interface ManagedSandbox {
  id: string;
  provider: string;
  state: SandboxLifecycleState;
  createdAt: Date;
  updatedAt: Date;
  ownerId?: string;
  expiresAt?: Date;
  metadata?: SandboxMetadata;
}

export interface CreateSandboxInput {
  ownerId?: string;
  metadata?: SandboxMetadata;
  runtime?: string;
  timeoutSeconds?: number;
  resourceProfile?: {
    vcpus?: number;
    memoryMb?: number;
  };
}

export interface ListSandboxesInput {
  states?: SandboxLifecycleState[];
  limit?: number;
}

export interface ExtendTimeoutInput {
  sandboxId: string;
  timeoutSeconds: number;
}

export interface RunSandboxCommandInput {
  sandboxId: string;
  command: string;
  cwd?: string;
  detached?: boolean;
  timeoutMs?: number;
}

export interface RunSandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

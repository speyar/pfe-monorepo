import type {
  CreateSandboxInput,
  ExtendTimeoutInput,
  ListSandboxesInput,
  ManagedSandbox,
  RunSandboxCommandInput,
  RunSandboxCommandResult,
} from "./contracts";

export interface SandboxProvider {
  readonly name: string;

  createSandbox(input: CreateSandboxInput): Promise<ManagedSandbox>;
  getSandbox(sandboxId: string): Promise<ManagedSandbox | null>;
  listSandboxes(input?: ListSandboxesInput): Promise<ManagedSandbox[]>;
  stopSandbox(sandboxId: string): Promise<ManagedSandbox>;
  extendTimeout(input: ExtendTimeoutInput): Promise<ManagedSandbox>;
  runCommand(input: RunSandboxCommandInput): Promise<RunSandboxCommandResult>;
}

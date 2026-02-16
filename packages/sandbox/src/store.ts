import type {
  ManagedSandbox,
  SandboxLifecycleState,
  SandboxMetadata,
} from "./contracts";

export interface SandboxStore {
  upsertSandbox(sandbox: ManagedSandbox): Promise<void>;
  getSandbox(sandboxId: string): Promise<ManagedSandbox | null>;
  listByStates(states: SandboxLifecycleState[]): Promise<ManagedSandbox[]>;
  markState(
    sandboxId: string,
    state: SandboxLifecycleState,
    metadata?: SandboxMetadata,
  ): Promise<void>;
}

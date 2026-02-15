import {
  ACTIVE_SANDBOX_STATES,
  type CreateSandboxInput,
  type ExtendTimeoutInput,
  type ManagedSandbox,
  type RunSandboxCommandInput,
  type RunSandboxCommandResult,
  type SandboxLifecycleState,
} from "./contracts";
import {
  ConfigError,
  PersistenceError,
  ReconciliationError,
  SandboxError,
  TimeoutError,
  isRetryableSandboxError,
} from "./errors";
import type { SandboxProvider } from "./provider";
import type { SandboxStore } from "./store";

export interface SandboxManagerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface SandboxManagerOptions {
  provider: SandboxProvider;
  store?: SandboxStore;
  logger?: SandboxManagerLogger;
  retryPolicy?: Partial<RetryPolicy>;
}

const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
};

const noopLogger: SandboxManagerLogger = {
  info: () => {
    return;
  },
  warn: () => {
    return;
  },
  error: () => {
    return;
  },
};

export class SandboxManager {
  private static instance: SandboxManager | null = null;

  private readonly provider: SandboxProvider;
  private readonly store?: SandboxStore;
  private readonly logger: SandboxManagerLogger;
  private readonly retryPolicy: RetryPolicy;
  private readonly sandboxes = new Map<string, ManagedSandbox>();

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor(options: SandboxManagerOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.logger = options.logger ?? noopLogger;
    this.retryPolicy = {
      ...defaultRetryPolicy,
      ...(options.retryPolicy ?? {}),
    };
  }

  public static getInstance(options?: SandboxManagerOptions): SandboxManager {
    if (!SandboxManager.instance) {
      if (!options) {
        throw new ConfigError(
          "SandboxManager is not initialized. Pass options on first getInstance call.",
        );
      }

      SandboxManager.instance = new SandboxManager(options);
    }

    return SandboxManager.instance;
  }

  public static resetForTesting(): void {
    SandboxManager.instance = null;
  }

  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.initializeInternal();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public listManagedSandboxes(): ManagedSandbox[] {
    return [...this.sandboxes.values()];
  }

  public listActiveSandboxes(): ManagedSandbox[] {
    return [...this.sandboxes.values()].filter((sandbox) =>
      ACTIVE_SANDBOX_STATES.includes(sandbox.state),
    );
  }

  public async createSandbox(input: CreateSandboxInput): Promise<ManagedSandbox> {
    await this.init();

    const sandbox = await this.executeWithRetry(
      async () => this.provider.createSandbox(input),
      "create sandbox",
    );

    this.upsertMemory(sandbox);
    await this.persistUpsert(sandbox);
    return sandbox;
  }

  public async getSandbox(
    sandboxId: string,
    options: { refresh?: boolean } = { refresh: true },
  ): Promise<ManagedSandbox | null> {
    await this.init();

    if (!options.refresh) {
      return this.sandboxes.get(sandboxId) ?? null;
    }

    const sandbox = await this.executeWithRetry(
      async () => this.provider.getSandbox(sandboxId),
      "get sandbox",
    );

    if (!sandbox) {
      this.sandboxes.delete(sandboxId);
      return null;
    }

    this.upsertMemory(sandbox);
    await this.persistUpsert(sandbox);
    return sandbox;
  }

  public async stopSandbox(sandboxId: string): Promise<ManagedSandbox> {
    await this.init();

    const sandbox = await this.executeWithRetry(
      async () => this.provider.stopSandbox(sandboxId),
      "stop sandbox",
    );

    this.upsertMemory(sandbox);
    await this.persistState(sandbox.id, sandbox.state, sandbox.metadata);
    return sandbox;
  }

  public async extendTimeout(input: ExtendTimeoutInput): Promise<ManagedSandbox> {
    await this.init();

    const sandbox = await this.executeWithRetry(
      async () => this.provider.extendTimeout(input),
      "extend timeout",
    );

    this.upsertMemory(sandbox);
    await this.persistUpsert(sandbox);
    return sandbox;
  }

  public async runCommand(
    input: RunSandboxCommandInput,
  ): Promise<RunSandboxCommandResult> {
    await this.init();
    return this.executeWithRetry(
      async () => this.provider.runCommand(input),
      "run sandbox command",
    );
  }

  private async initializeInternal(): Promise<void> {
    try {
      const providerActiveSandboxes = await this.executeWithRetry(
        async () =>
          this.provider.listSandboxes({
            states: [...ACTIVE_SANDBOX_STATES],
          }),
        "list active sandboxes from provider",
      );

      let persistedActiveSandboxes: ManagedSandbox[] = [];
      if (this.store) {
        persistedActiveSandboxes = await this.store.listByStates([
          ...ACTIVE_SANDBOX_STATES,
        ]);
      }

      await this.reconcileOnInit(providerActiveSandboxes, persistedActiveSandboxes);
      this.initialized = true;
      this.logger.info("SandboxManager initialized", {
        activeCount: providerActiveSandboxes.length,
        provider: this.provider.name,
      });
    } catch (error) {
      throw new ReconciliationError(
        "Failed to initialize SandboxManager from provider active sandboxes.",
        error,
      );
    }
  }

  private async reconcileOnInit(
    providerActiveSandboxes: ManagedSandbox[],
    persistedActiveSandboxes: ManagedSandbox[],
  ): Promise<void> {
    const providerById = new Map(
      providerActiveSandboxes.map((sandbox) => [sandbox.id, sandbox]),
    );

    for (const providerSandbox of providerActiveSandboxes) {
      const persistedSandbox = persistedActiveSandboxes.find(
        (item) => item.id === providerSandbox.id,
      );
      const merged = this.mergeSandbox(providerSandbox, persistedSandbox);
      this.upsertMemory(merged);
      await this.persistUpsert(merged);
    }

    for (const persistedSandbox of persistedActiveSandboxes) {
      if (providerById.has(persistedSandbox.id)) {
        continue;
      }

      const orphanedSandbox: ManagedSandbox = {
        ...persistedSandbox,
        state: "stopped",
        updatedAt: new Date(),
        metadata: {
          ...(persistedSandbox.metadata ?? {}),
          reconciled: true,
          reconcileReason: "missing-in-provider",
        },
      };

      this.upsertMemory(orphanedSandbox);
      await this.persistState(
        orphanedSandbox.id,
        orphanedSandbox.state,
        orphanedSandbox.metadata,
      );
      this.logger.warn("Persisted sandbox missing from provider on init", {
        sandboxId: orphanedSandbox.id,
      });
    }
  }

  private mergeSandbox(
    providerSandbox: ManagedSandbox,
    persistedSandbox?: ManagedSandbox,
  ): ManagedSandbox {
    return {
      ...providerSandbox,
      ownerId: providerSandbox.ownerId ?? persistedSandbox?.ownerId,
      metadata: {
        ...(persistedSandbox?.metadata ?? {}),
        ...(providerSandbox.metadata ?? {}),
      },
    };
  }

  private upsertMemory(sandbox: ManagedSandbox): void {
    this.sandboxes.set(sandbox.id, {
      ...sandbox,
      updatedAt: sandbox.updatedAt ?? new Date(),
    });
  }

  private async persistUpsert(sandbox: ManagedSandbox): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      await this.store.upsertSandbox(sandbox);
    } catch (error) {
      throw new PersistenceError(
        `Failed to persist sandbox upsert for ${sandbox.id}.`,
        error,
      );
    }
  }

  private async persistState(
    sandboxId: string,
    state: SandboxLifecycleState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      await this.store.markState(sandboxId, state, metadata);
    } catch (error) {
      throw new PersistenceError(
        `Failed to persist sandbox state for ${sandboxId}.`,
        error,
      );
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        const retryable = isRetryableSandboxError(error);
        const isFinalAttempt = attempt === this.retryPolicy.maxAttempts;

        if (!retryable || isFinalAttempt) {
          throw this.normalizeOperationError(error, operationName);
        }

        const delay = this.calculateDelay(attempt);
        this.logger.warn("Sandbox operation failed, retrying", {
          operationName,
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw this.normalizeOperationError(lastError, operationName);
  }

  private normalizeOperationError(error: unknown, operationName: string): Error {
    if (error instanceof SandboxError) {
      return error;
    }

    const status = (error as { status?: number })?.status;
    const message =
      error instanceof Error ? error.message : `Unknown failure in ${operationName}`;

    if (status === 408) {
      return new TimeoutError(`Timeout while trying to ${operationName}.`, error);
    }

    return new SandboxError(`Failed to ${operationName}: ${message}`, "OPERATION_FAILED", error);
  }

  private calculateDelay(attempt: number): number {
    const base = this.retryPolicy.baseDelayMs * 2 ** (attempt - 1);
    const capped = Math.min(base, this.retryPolicy.maxDelayMs);
    const jitter = Math.floor(Math.random() * 100);
    return capped + jitter;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

import { beforeEach, describe, expect, it } from "vitest";

import type {
  CreateSandboxInput,
  ExtendTimeoutInput,
  ListSandboxesInput,
  ManagedSandbox,
  RunSandboxCommandInput,
  RunSandboxCommandResult,
  SandboxLifecycleState,
} from "./contracts";
import { ConfigError, ReconciliationError, SandboxError } from "./errors";
import { SandboxManager } from "./manager";
import type { SandboxProvider } from "./provider";
import type { SandboxStore } from "./store";

class FakeProvider implements SandboxProvider {
  public readonly name = "fake";

  public createCalls = 0;
  public listCalls = 0;

  public sandboxes: ManagedSandbox[] = [];
  public failCreateAttempts = 0;
  public failList = false;

  async createSandbox(input: CreateSandboxInput): Promise<ManagedSandbox> {
    this.createCalls += 1;
    if (this.failCreateAttempts > 0) {
      this.failCreateAttempts -= 1;
      const error = new Error("rate limited");
      error.name = "RateLimitError";
      throw error;
    }

    const created = createSandboxFixture({
      id: `created-${this.createCalls}`,
      state: "running",
      ownerId: input.ownerId,
      metadata: input.metadata,
    });
    this.sandboxes.push(created);
    return created;
  }

  async getSandbox(sandboxId: string): Promise<ManagedSandbox | null> {
    return this.sandboxes.find((item) => item.id === sandboxId) ?? null;
  }

  async listSandboxes(input?: ListSandboxesInput): Promise<ManagedSandbox[]> {
    this.listCalls += 1;
    if (this.failList) {
      throw new Error("provider unavailable");
    }

    if (!input?.states?.length) {
      return [...this.sandboxes];
    }

    return this.sandboxes.filter((item) => input.states?.includes(item.state));
  }

  async stopSandbox(sandboxId: string): Promise<ManagedSandbox> {
    const sandbox = this.sandboxes.find((item) => item.id === sandboxId);
    if (!sandbox) {
      throw new Error(`missing sandbox ${sandboxId}`);
    }

    sandbox.state = "stopped";
    sandbox.updatedAt = new Date();
    return sandbox;
  }

  async extendTimeout(input: ExtendTimeoutInput): Promise<ManagedSandbox> {
    const sandbox = this.sandboxes.find((item) => item.id === input.sandboxId);
    if (!sandbox) {
      throw new Error(`missing sandbox ${input.sandboxId}`);
    }

    sandbox.expiresAt = new Date(Date.now() + input.timeoutSeconds * 1000);
    sandbox.updatedAt = new Date();
    return sandbox;
  }

  async runCommand(
    _input: RunSandboxCommandInput,
  ): Promise<RunSandboxCommandResult> {
    return {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    };
  }
}

class FakeStore implements SandboxStore {
  public upserts: ManagedSandbox[] = [];
  public stateChanges: Array<{
    sandboxId: string;
    state: SandboxLifecycleState;
    metadata?: Record<string, unknown>;
  }> = [];

  constructor(private readonly persisted: ManagedSandbox[] = []) {}

  async upsertSandbox(sandbox: ManagedSandbox): Promise<void> {
    this.upserts.push(sandbox);
  }

  async getSandbox(sandboxId: string): Promise<ManagedSandbox | null> {
    return this.persisted.find((item) => item.id === sandboxId) ?? null;
  }

  async listByStates(
    states: SandboxLifecycleState[],
  ): Promise<ManagedSandbox[]> {
    return this.persisted.filter((item) => states.includes(item.state));
  }

  async markState(
    sandboxId: string,
    state: SandboxLifecycleState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.stateChanges.push({ sandboxId, state, metadata });
  }
}

describe("SandboxManager", () => {
  beforeEach(() => {
    SandboxManager.resetForTesting();
  });

  it("throws if getInstance() is called without first-time options", () => {
    expect(() => SandboxManager.getInstance()).toThrow(ConfigError);
  });

  it("initializes once and lists provider active sandboxes", async () => {
    const provider = new FakeProvider();
    provider.sandboxes = [
      createSandboxFixture({ id: "sb-1", state: "running" }),
    ];

    const manager = SandboxManager.getInstance({ provider });
    await manager.init();
    await manager.init();

    expect(provider.listCalls).toBe(1);
    expect(manager.listActiveSandboxes().map((item) => item.id)).toEqual([
      "sb-1",
    ]);
  });

  it("reconciles provider and persisted active sandboxes on init", async () => {
    const provider = new FakeProvider();
    provider.sandboxes = [
      createSandboxFixture({ id: "provider-1", state: "running" }),
    ];

    const store = new FakeStore([
      createSandboxFixture({
        id: "provider-1",
        state: "running",
        ownerId: "u-1",
      }),
      createSandboxFixture({ id: "persisted-only", state: "running" }),
    ]);

    const manager = SandboxManager.getInstance({ provider, store });
    await manager.init();

    expect(store.upserts.map((item) => item.id)).toContain("provider-1");
    expect(
      store.stateChanges.some(
        (item) =>
          item.sandboxId === "persisted-only" && item.state === "stopped",
      ),
    ).toBe(true);

    const managed = manager.listManagedSandboxes();
    const orphaned = managed.find((item) => item.id === "persisted-only");
    expect(orphaned?.state).toBe("stopped");
  });

  it("retries transient provider errors during createSandbox", async () => {
    const provider = new FakeProvider();
    provider.failCreateAttempts = 1;

    const manager = SandboxManager.getInstance({
      provider,
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
    });

    const sandbox = await manager.createSandbox({ ownerId: "user-1" });
    expect(sandbox.id).toBe("created-2");
    expect(provider.createCalls).toBe(2);
  });

  it("wraps init failures into ReconciliationError", async () => {
    const provider = new FakeProvider();
    provider.failList = true;

    const manager = SandboxManager.getInstance({ provider });
    await expect(manager.init()).rejects.toBeInstanceOf(ReconciliationError);
  });

  it("returns cached sandbox when refresh=false", async () => {
    const provider = new FakeProvider();
    provider.sandboxes = [
      createSandboxFixture({ id: "sb-cache", state: "running" }),
    ];

    const manager = SandboxManager.getInstance({ provider });
    await manager.init();

    const cached = await manager.getSandbox("sb-cache", { refresh: false });
    expect(cached?.id).toBe("sb-cache");
  });

  it("throws sandbox error for non-retryable provider failures", async () => {
    const provider = new FakeProvider();
    provider.createSandbox = async () => {
      throw new Error("validation failed");
    };

    const manager = SandboxManager.getInstance({ provider });
    await expect(manager.createSandbox({})).rejects.toBeInstanceOf(
      SandboxError,
    );
  });
});

function createSandboxFixture(
  overrides: Partial<ManagedSandbox> & Pick<ManagedSandbox, "id" | "state">,
): ManagedSandbox {
  const now = new Date();
  return {
    id: overrides.id,
    provider: overrides.provider ?? "fake",
    state: overrides.state,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ownerId: overrides.ownerId,
    expiresAt: overrides.expiresAt,
    metadata: overrides.metadata,
  };
}

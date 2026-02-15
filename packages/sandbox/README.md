# @packages/sandbox

API-first sandbox management library with a process-local singleton manager, provider adapters, and optional persistence store.

## Goals

- Centralize sandbox lifecycle management in one `SandboxManager` instance.
- Keep provider integration pluggable via `SandboxProvider` (Vercel now, Cloudflare/test later).
- Allow app-specific persistence with `SandboxStore` without forcing a DB implementation in this package.
- Recover active sandboxes on startup with provider-first reconciliation.

## Public API

- `SandboxManager`
- `SandboxProvider` interface
- `SandboxStore` interface
- Contracts (`ManagedSandbox`, `CreateSandboxInput`, lifecycle states, command inputs)
- Typed errors (`ConfigError`, `ReconciliationError`, `PersistenceError`, etc.)

## Manager lifecycle

- First call must provide options: `SandboxManager.getInstance({ provider, store })`
- Subsequent calls can use `SandboxManager.getInstance()`
- `init()` is idempotent and safe to call many times
- On `init()`, manager tries provider active sandboxes first (`pending`, `running`, `stopping`), then reconciles with store state

## Usage

```ts
import { SandboxManager, type SandboxProvider, type SandboxStore } from "@packages/sandbox";

const provider: SandboxProvider = /* your Vercel adapter */ null as never;
const store: SandboxStore = /* your DB adapter */ null as never;

const manager = SandboxManager.getInstance({ provider, store });
await manager.init();

const sandbox = await manager.createSandbox({
  ownerId: "user_123",
  timeoutSeconds: 300,
  metadata: { projectId: "p_1" },
});

await manager.runCommand({ sandboxId: sandbox.id, command: "npm test" });
```

## Error handling

- Manager normalizes operation errors into typed `SandboxError` derivatives.
- Retry strategy is built-in for retryable errors (timeouts/rate limits/5xx).
- Persistence failures raise `PersistenceError` to avoid silent state drift.

## Notes

- This package intentionally does not include a concrete Vercel/Cloudflare adapter implementation yet.
- Adapter implementations should map provider-native states into `SandboxLifecycleState` and preserve provider metadata.
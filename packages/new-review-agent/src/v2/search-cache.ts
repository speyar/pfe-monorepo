import type { SandboxManager } from "@packages/sandbox";
import { runCommand, splitLines, textPreview } from "./utils";
import { debug } from "./debug";

interface SearchResult {
  count: number;
  timestamp: number;
}

class SearchCache {
  private cache: Map<string, SearchResult> = new Map();
  private readonly ttl: number; // Time to live in milliseconds

  constructor(ttlMs: number = 5000) {
    // Default 5 second TTL
    this.ttl = ttlMs;
  }

  get(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      // Expired, remove from cache
      this.cache.delete(key);
      return null;
    }

    return entry.count;
  }

  set(key: string, count: number): void {
    this.cache.set(key, {
      count,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global cache instance for the lifetime of the dependency map building process
const symbolReferenceCache = new SearchCache(10000); // 10 second TTL

async function searchSymbolReferencesCached(
  sandboxManager: SandboxManager,
  sandboxId: string,
  command: "rg" | "grep",
  symbol: string,
): Promise<number> {
  // Try cache first
  const cacheKey = `${command}:${symbol}`;
  const cachedResult = symbolReferenceCache.get(cacheKey);
  if (cachedResult !== null) {
    debug("dependency-map-symbol-cache-hit", { symbol });
    return cachedResult;
  }

  // Not in cache, perform actual search
  const result =
    command === "rg"
      ? await runCommand(sandboxManager, sandboxId, "rg", [
          "--line-number",
          "--no-heading",
          "--fixed-strings",
          symbol,
          ".",
        ])
      : await runCommand(sandboxManager, sandboxId, "grep", [
          "-R",
          "-n",
          "-F",
          symbol,
          ".",
        ]);

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    debug("dependency-map-symbol-scan-failed", {
      symbol,
      command,
      exitCode: result.exitCode,
      stderr: textPreview(result.stderr, 280),
    });
  }

  const stdout = result.stdout ?? "";
  const count = splitLines(stdout).length;

  // Store in cache
  symbolReferenceCache.set(cacheKey, count);

  debug("dependency-map-symbol-cache-miss", { symbol, count });

  return count;
}

export { searchSymbolReferencesCached, symbolReferenceCache };

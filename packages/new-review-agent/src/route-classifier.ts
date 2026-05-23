import type { RouteClassification } from "./v2/types";

const SECURITY_PATTERNS = [
  "/api/",
  "route.ts",
  "route.tsx",
  "/auth/",
  "/webhooks/",
  "/webhook/",
  "middleware",
  "auth",
  "session",
  "clerk",
  "next-auth",
];

const LOGIC_PATTERNS = [
  "/lib/",
  "/utils/",
  "/helpers/",
  "/services/",
  "/hooks/",
  "/stores/",
  "provider",
  "context",
  "transaction",
  "mutation",
  "query",
];

const INFRA_PATTERNS = [
  "prisma/schema",
  "package.json",
  "tsconfig",
  "docker",
  ".github/",
  "turbo.json",
  "Dockerfile",
  "bun.lock",
  "migration",
  "seed",
];

function scorePath(
  path: string,
  patterns: string[],
  weight: number,
): number {
  const normalized = path.toLowerCase();
  let score = 0;
  for (const pattern of patterns) {
    if (normalized.includes(pattern)) {
      score += weight;
    }
  }
  return score;
}

function scoreTags(tags: string[], pattern: string): number {
  return tags.includes(pattern) ? 5 : 0;
}

export function classifyRoutes(
  changedFiles: string[],
  dependencyTags?: string[],
): RouteClassification {
  const tags = dependencyTags ?? [];

  let security = 0;
  let logic = 0;
  let ui = 0;
  let infra = 0;

  for (const file of changedFiles) {
    security += scorePath(file, SECURITY_PATTERNS, 2);
    logic += scorePath(file, LOGIC_PATTERNS, 1);
    infra += scorePath(file, INFRA_PATTERNS, 3);
  }

  security += scoreTags(tags, "auth") + scoreTags(tags, "api");
  logic += scoreTags(tags, "core");

  const fileCount = changedFiles.length;

  const significantChange = fileCount > 5;
  const securityFileCount = changedFiles.filter(
    (f) =>
      f.includes("/api/") || f.endsWith("route.ts") || f.endsWith("route.tsx") || f.includes("/auth/") || f.includes("/webhooks/"),
  ).length;

  if (securityFileCount > 0 && securityFileCount < fileCount * 0.8) {
    logic += 3;
    ui += 1;
  }

  if (significantChange) {
    logic += 2;
    ui += 1;
  }

  return {
    security,
    logic,
    ui,
    infra,
    shouldRunSecurity: security > 2,
    shouldRunLogic: logic > 3,
  };
}

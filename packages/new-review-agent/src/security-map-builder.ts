import type { SandboxManager } from "@packages/sandbox";
import type { PreComputedSecurityContext, QueryPattern } from "./v2/types";

const AUTH_FUNCTIONS = [
  "auth()",
  "getAuth()",
  "currentUser()",
  "getSession()",
  "requireAuth",
  "getServerSession",
  "getToken",
  "clerkClient",
  "authenticate",
];

const USER_SCOPING_FIELDS = [
  "userId",
  "clerkId",
  "organizationId",
  "ownerId",
  "creatorId",
  "authorId",
  "accountId",
  "teamId",
  "user",
  "author",
  "creator",
  "owner",
];

const PRISMA_QUERY_REGEX =
  /prisma\.(\w+)\.(findUnique|findMany|findFirst|findFirstOrThrow|findUniqueOrThrow|delete|update|updateMany|deleteMany|create|createMany|upsert|count|aggregate)/g;

const WHERE_ID_ONLY_REGEX = /where:\s*\{\s*id\s*:/;

const WEBHOOK_SIGNATURE_REGEX =
  /verify|signature|hmac|webhook.secret|x-hub-signature|stripe-signature|crypto\.timingSafeEqual|timingSafeEqual/;

const AUTH_IMPORT_REGEX =
  /from ["']@clerk|from ["']next-auth|from ["'].*\/auth["']|from ["']next\/headers\/auth["']/;

export async function buildSecurityMap(
  sandboxManager: SandboxManager,
  sandboxId: string,
  files: Array<{ path: string; patch: string }>,
): Promise<PreComputedSecurityContext[]> {
  const contexts: PreComputedSecurityContext[] = [];

  const apiRouteFiles = files.filter(
    (f) =>
      f.path.includes("/api/") ||
      f.path.endsWith("route.ts") ||
      f.path.endsWith("route.tsx") ||
      f.path.includes("/webhooks/") ||
      f.path.includes("/webhook/"),
  );

  for (const file of apiRouteFiles) {
    try {
      const result = await sandboxManager.runCommand({
        sandboxId,
        command: "cat",
        args: [file.path],
      });

      if (result.exitCode !== 0 || !result.stdout) {
        contexts.push({
          filePath: file.path,
          hasAuth: false,
          authFunction: undefined,
          queries: [],
          hasDangerouslySetInnerHTML: false,
          isWebhook: file.path.includes("/webhook"),
          hasHmacVerification: false,
          isApiRoute: true,
          riskNotes: ["Could not read file content"],
        });
        continue;
      }

      const content = result.stdout;
      const queries = extractQueries(content, file.path);
      const hasAuth = hasAuthCheck(content);
      const authFunc = extractAuthFunction(content);
      const hasDangerouslySetInnerHTML = content.includes("dangerouslySetInnerHTML");
      const hmacVerified = hasWebhookVerification(content);

      const riskNotes: string[] = [];

      if (!hasAuth && !hmacVerified) {
        riskNotes.push("No authentication or HMAC verification detected");
      }

      for (const query of queries) {
        if (!query.hasUserScoping) {
          riskNotes.push(
            `Query prisma.${query.model}.${query.type} at line ${query.line} filters by [${query.whereFields.join(", ")}] only — no user-scoping detected`,
          );
        }
      }

      if (hasDangerouslySetInnerHTML) {
        const hasSanitizer =
          content.includes("DOMPurify") ||
          content.includes("sanitize-html") ||
          content.includes("sanitize");
        if (!hasSanitizer) {
          riskNotes.push(
            "dangerouslySetInnerHTML used without sanitizer (DOMPurify/sanitize-html)",
          );
        }
      }

      contexts.push({
        filePath: file.path,
        hasAuth,
        authFunction: authFunc,
        queries,
        hasDangerouslySetInnerHTML,
        isWebhook: file.path.includes("/webhook"),
        hasHmacVerification: hmacVerified,
        isApiRoute: true,
        riskNotes,
      });
    } catch (error) {
      contexts.push({
        filePath: file.path,
        hasAuth: false,
        queries: [],
        hasDangerouslySetInnerHTML: false,
        isWebhook: file.path.includes("/webhook"),
        hasHmacVerification: false,
        isApiRoute: true,
        riskNotes: [
          `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
    }
  }

  return contexts;
}

function hasAuthCheck(content: string): boolean {
  for (const func of AUTH_FUNCTIONS) {
    if (content.includes(func)) return true;
  }
  return AUTH_IMPORT_REGEX.test(content);
}

function extractAuthFunction(content: string): string | undefined {
  for (const func of AUTH_FUNCTIONS) {
    if (content.includes(func)) return func;
  }
  if (AUTH_IMPORT_REGEX.test(content)) {
    return "auth import detected";
  }
  return undefined;
}

function extractQueries(content: string, filePath: string): QueryPattern[] {
  const queries: QueryPattern[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line) continue;

    PRISMA_QUERY_REGEX.lastIndex = 0;
    const match = PRISMA_QUERY_REGEX.exec(line);
    if (!match) continue;

    const model = match[1] ?? "unknown";
    const queryType = match[2] ?? "findMany";

    const whereFields = extractWhereFields(line, lines, i);
    const hasUserScoping = whereFields.some((field) =>
      USER_SCOPING_FIELDS.includes(field),
    );

    queries.push({
      type: queryType,
      model,
      whereFields,
      hasUserScoping,
      line: i + 1,
    });
  }

  return queries;
}

function extractWhereFields(
  line: string,
  allLines: string[],
  lineIndex: number,
): string[] {
  const whereMatch = line.match(/where:\s*\{([^}]*)\}/);
  if (whereMatch) {
    const fields = (whereMatch[1] ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => f.split(":")[0]?.trim())
      .filter((f): f is string => Boolean(f));
    return fields;
  }

  const truncatedWhere = /where:\s*(?:\{[^}]*)?$/.exec(line);
  if (truncatedWhere) {
    const fields: string[] = [];
    for (
      let j = lineIndex + 1;
      j < Math.min(lineIndex + 10, allLines.length);
      j++
    ) {
      const checkLine = allLines[j];
      if (!checkLine) continue;
      if (checkLine.trim() === "}") break;
      const fieldMatch = checkLine.match(/^\s*(\w+)\s*:/);
      if (fieldMatch && fieldMatch[1] != null) {
        fields.push(fieldMatch[1]);
      }
    }
    return fields;
  }

  return [];
}

function hasWebhookVerification(content: string): boolean {
  return WEBHOOK_SIGNATURE_REGEX.test(content);
}

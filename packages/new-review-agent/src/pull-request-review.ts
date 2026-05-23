import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgent, type Skill } from "./review-agent";
import type { DiffSummary } from "./diff-summarize";
import { generateCodebaseGraph } from "./graph-generator";
import type { LanguageModel } from "ai";
import {
  runSubReviews,
  mergeSubFindings,
  buildSubFindingsPrompt,
} from "./fan-out-review";
import { prepareBranchContext } from "./v2/branch-context";
import { buildDependencyMap } from "./v2/dependency-map";
import { collectPatchesByFile } from "./v2/diff-context";
import { runCrossReference } from "./cross-ref-agent";
import type {
  DependencyMap,
  DependencyNode,
  DependencyEdge,
  RouteClassification,
  PreComputedSecurityContext,
  SkillDefinition,
  V2ReviewFinding,
} from "./v2/types";
import { classifyRoutes } from "./route-classifier";
import { buildSecurityMap } from "./security-map-builder";
import { routeSkills } from "./v2/skill-router";
import { harvestEvidence } from "./v2/evidence-harvest";
import { EvidenceStore } from "./v2/evidence-store";
import { runSkillWorker } from "./v2/skill-worker";

export type PullRequestReviewVerdict =
  | "approve"
  | "comment"
  | "request_changes";

export interface PullRequestReviewFinding {
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  file: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface PullRequestReviewSummary {
  verdict: PullRequestReviewVerdict;
  score: number;
  overview: string;
  risk: string;
  model?: string;
  elapsedMs?: number;
}

export interface PullRequestReviewResult {
  summary: PullRequestReviewSummary;
  findings: PullRequestReviewFinding[];
  agentSummaries?: { agentId: string; summary: string }[];
  notes?: string[];
}

export interface PullRequestReviewInput {
  installationId: number;
  owner: string;
  repo: string;
  headRef: string;
  baseRef?: string;
  initialDiff?: string;
  diffSummary?: DiffSummary;
  files?: Array<{ path: string; patch: string }>;
}

export interface PullRequestReviewOptions {
  modelName?: string;
  model?: LanguageModel;
  ownerId?: string;
  repositoryUrl?: string;
  maxFindings?: number;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  skills?: Skill[];
  maxFilesBeforeFanOut?: number;
}

async function generateNonBlockingGraph(
  manager: SandboxManager,
  sandboxId: string,
  rootPath: string,
  outPath: string,
): Promise<{
  graphPath: string;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  packageCount: number;
  elapsedMs: number;
} | null> {
  console.log("[review] Starting graph generation (non-blocking)...");
  try {
    const result = await generateCodebaseGraph(manager, sandboxId, {
      rootPath,
      outPath,
      pretty: true,
    });
    console.log(
      `[review] Graph generated in background — packages=${result.packageCount}, files=${result.fileCount}, nodes=${result.nodeCount}, edges=${result.elapsedMs}`,
    );
    return result;
  } catch (error) {
    console.warn(
      "[review] Graph generation failed in background:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function getSecuritySkillContent(): string {
  return `# Security Review Agent

You are a specialized security review agent. Your SOLE responsibility is to find security vulnerabilities.

You have been given evidence including pre-computed security context for API routes, full file reads, and grep results.

## Severity
- **P0**: Data leak, auth bypass, injection, secret exposure
- **P1**: Broken access control, missing authorization, CSRF/state gap
- **P2**: Unsafe type assertion, unreachable fallback, hardening gap
- **P3**: Error leakage in production, missing pagination

## Categories (check EVERY one):

1. **Authentication & IDOR** — Does every API route verify auth? Does every \`prisma\` query scope by the authenticated user? Pattern \`findUnique({ where: { id } })\` without \`userId\` = P0.
2. **Ownership propagation** — Every API route calling \`auth()\` MUST propagate the user into all Prisma queries. Any \`findUnique\` by raw id without \`installation.clerkUserId\` join = P0.
3. **OAuth & Callback** — State/nonce validation? Public route exposure? Callbacks behind auth middleware?
4. **XSS** — \`dangerouslySetInnerHTML\` without DOMPurify? \`innerHTML\` assignments?
5. **Injection** — \`$queryRaw\`/\`$executeRaw\` string interpolation? \`exec\`/\`eval\`/\`spawn\`?
6. **CSRF** — Cookie-authenticated mutations without CSRF token or custom header?
7. **Mass Assignment** — \`prisma.create({ data: { ...body } })\` unfiltered?
8. **Webhook HMAC** — Missing signature verification on webhooks?
9. **SSRF** — User-controlled URL passed to \`fetch()\`?
10. **Rate Limiting** — Auth/mutation endpoints without throttling?
11. **Cache Poisoning** — Auth-dependent responses with public cache?
12. **TOCTOU** — Non-atomic balance/state operations?
13. **CORS** — Wildcard with credentials?
14. **Token Leakage** — Tokens in URLs, error messages, logs?
15. **Prototype Pollution** — Unsafe object spreads from user input?
16. **Type Assertions** — \`payload as SomeType\` from \`unknown\` without Zod?
17. **Error Leakage** — Stack traces or full error objects in production responses?
18. **Unreachable Code** — Early return making subsequent fallback dead code?

## Rules
- Verify EVERY pre-computed security context finding by reading actual code
- Cast a wide net — false negatives are worse than false positives for security
- Output ONLY findings confirmed by reading actual code
- Pre-computed context is a HINT, not truth — validate it`;
}

function getLogicSkillContent(): string {
  return `# Logic & Correctness Review Agent

You are a specialized logic review agent. Your responsibility is to find behavioral bugs, race conditions, and correctness issues.

## Severity
- **P1**: Behavioral regression, broken contract, null pointer in production
- **P2**: Logic bug, race condition, read-then-write race, unreachable code
- **P3**: Unbounded query, missing error log
- **P4**: Verified dead code

## Categories:

1. **Null/undefined safety** — Can a variable be null/undefined at the point it's used? New code paths that skip initialization?
2. **Error handling** — Are thrown exceptions or rejected promises caught? Does the error handler leave state inconsistent?
3. **Race conditions** — Concurrent access to shared state without locks/transactions? Check for \`prisma.$transaction\` patterns. Read-then-write (\`findUnique\` then \`create\`) without \`$transaction\` = P2.
4. **Off-by-one / boundary errors** — Loop conditions, array indices, pagination limits, string lengths.
5. **API contract changes** — Changed function signatures that callers don't handle? Changed return types? Removed exports?
6. **Response shape consistency** — Multiple \`return Response.json()\` paths in same handler with different keys?
7. **Unbounded queries** — \`findMany\` without \`take\` followed by \`.slice()\` in JS?
8. **Read-then-write races** — findUnique check followed by create/update without $transaction?
9. **Dead code** — Exported constants never imported? Functions defined but never called? Verified via cross-file search.
10. **State management** — React state not initialized before use? SWR/React Query cache not invalidated after mutation?
11. **Side effects** — DB writes, external API calls, cache invalidations, event emissions — are they still correct after the change?

## Rules
- Focus on behavioral changes, not style
- Cross-reference callers to verify contract compliance
- Output specific, actionable findings with code suggestions`;
}

function toFindings(
  findings: Awaited<ReturnType<typeof runReviewAgent>>["findings"],
): PullRequestReviewFinding[] {
  return findings.map((finding) => ({
    severity: finding.severity,
    file: finding.file ?? "unknown",
    line: finding.line,
    quote: finding.quote,
    title: finding.title,
    message: finding.message,
    suggestion: finding.suggestion,
  }));
}

function scoreFromFindings(findings: PullRequestReviewFinding[]): number {
  const severityPenalty = findings.reduce((sum, finding) => {
    switch (finding.severity) {
      case "P0":
        return sum + 50;
      case "P1":
        return sum + 25;
      case "P2":
        return sum + 10;
      case "P3":
        return sum + 4;
      default:
        return sum + 1;
    }
  }, 0);

  return Math.max(0, Math.min(100, 100 - severityPenalty));
}

function buildSummary(
  findings: PullRequestReviewFinding[],
  modelName: string,
  elapsedMs: number,
): PullRequestReviewSummary {
  const hasP0OrP1 = findings.some(
    (finding) => finding.severity === "P0" || finding.severity === "P1",
  );
  const hasP2 = findings.some((finding) => finding.severity === "P2");

  const verdict: PullRequestReviewVerdict =
    findings.length === 0
      ? "approve"
      : hasP0OrP1
        ? "request_changes"
        : "comment";

  const risk = hasP0OrP1 ? "high" : hasP2 ? "medium" : "low";
  const score = scoreFromFindings(findings);
  const overview =
    findings.length === 0
      ? "No blocking findings detected in this pull request."
      : `Detected ${findings.length} finding${
          findings.length === 1 ? "" : "s"
        } that should be reviewed before merge.`;

  return {
    verdict,
    score,
    overview,
    risk,
    model: modelName,
    elapsedMs,
  };
}

export async function runPullRequestReview(
  input: PullRequestReviewInput,
  options: PullRequestReviewOptions = {},
): Promise<PullRequestReviewResult> {
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
  if (!copilotToken) {
    throw new Error("Missing COPILOT_GITHUB_TOKEN");
  }

  const modelName =
    options.modelName ?? process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
  });
  const model = provider(modelName);

  const githubClient = await getGitHubClient(input.installationId);
  const {
    data: { token },
  } = await githubClient.rest.apps.createInstallationAccessToken({
    installation_id: input.installationId,
  });

  const vercelProvider = new VercelSandboxProvider();
  const manager = SandboxManager.getInstance({
    provider: vercelProvider,
    logger: console,
  });

  const sandbox = await manager.createSandbox({
    ownerId: "test-owner",
    timeoutSeconds: 900,
    source: {
      type: "git",
      url:
        options.repositoryUrl ??
        `https://github.com/${input.owner}/${input.repo}.git`,
      username: "x-access-token",
      password: token,
    },
  });

  const startedAt = Date.now();
  const notes: string[] = [];
  const partialFindings: PullRequestReviewFinding[] = [];

  try {
    const cwdResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
    });
    const workingDir = cwdResult.stdout.trim() || "/home/user";
    const graphPath = `${workingDir}/codebase-graph.json`;

    const files = input.files ?? [];
    const threshold = options.maxFilesBeforeFanOut ?? 30;
    const hasSubFindings = files.length > threshold;

    // ─── Phase 0: Start graph generation (non-blocking) ───
    const graphPromise = generateNonBlockingGraph(
      manager,
      sandbox.id,
      workingDir,
      graphPath,
    );

    // ─── Phase 1: Branch context + dep map (needed for routing) ───
    console.log("[review] Building branch context and dependency map...");
    const branchCtx = await prepareBranchContext({
      sandboxManager: manager,
      sandboxId: sandbox.id,
      branchName: input.headRef,
      defaultBranch: input.baseRef,
    });
    const { patchesByFile } = await collectPatchesByFile({
      sandboxManager: manager,
      sandboxId: sandbox.id,
      defaultBranch: branchCtx.defaultBranch,
      changedFiles: branchCtx.changedFiles,
    });
    const depMap = await buildDependencyMap({
      sandboxManager: manager,
      sandboxId: sandbox.id,
      branch: branchCtx,
      patchesByFile,
    }).catch((err: Error) => {
      console.warn("[review] Dep map build failed:", err.message);
      return undefined;
    });

    const depNodes = depMap?.nodes;
    const depEdges = depMap?.edges;

    // ─── Phase 1: Route classification ───
    const classification = classifyRoutes(branchCtx.changedFiles, depMap?.tags);
    console.log(
      `[review] Route classification — security=${classification.security}, logic=${classification.logic}, ui=${classification.ui}, infra=${classification.infra}`,
    );

    // ─── Phase 1: Security map (pre-read API routes) ───
    let securityMap: PreComputedSecurityContext[] = [];
    if (classification.shouldRunSecurity) {
      console.log("[review] Building security map...");
      securityMap = await buildSecurityMap(manager, sandbox.id, files).catch(
        (err: Error) => {
          console.warn("[review] Security map build failed:", err.message);
          return [];
        },
      );
      if (securityMap.length > 0) {
        const atRisk = securityMap.filter((s) => s.riskNotes.length > 0);
        console.log(
          `[review] Security map: ${securityMap.length} routes analyzed, ${atRisk.length} with risk notes`,
        );
        for (const s of atRisk.slice(0, 5)) {
          console.log(
            `[review]   ${s.filePath}: ${s.riskNotes.slice(0, 2).join("; ")}`,
          );
        }
      }
    }

    // ─── Phase 1: Build diff + dependency context string ───
    const dependencyContext = depMap
      ? [
          "DEPENDENCY MAP (patch-level analysis):",
          ...depMap.summary,
          "",
          "Top symbols: " + depMap.topSymbols.slice(0, 10).join(", "),
          "Hot files: " + depMap.hotFiles.slice(0, 8).join(", "),
        ].join("\n")
      : "";

    const hasSecurityFiles = files.some(
      (f) =>
        f.path.includes("/api/") ||
        f.path.endsWith("route.ts") ||
        f.path.endsWith("route.tsx") ||
        f.path.includes("/auth/") ||
        f.path.includes("/webhooks/"),
    );

    // ─── Phase 2: Try to get graph (may have finished in background) ───
    let effectiveGraphPath: string | undefined;
    let graphAvailable = false;
    try {
      const timeoutMs = 300_000;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Graph generation timed out")),
          timeoutMs,
        ),
      );
      const graphResult = await Promise.race([graphPromise, timeout]);
      if (graphResult && "packageCount" in graphResult) {
        effectiveGraphPath = graphPath;
        graphAvailable = true;
        console.log(
          `[review] Graph generated — packages=${graphResult.packageCount}, files=${graphResult.fileCount}, nodes=${graphResult.nodeCount}, edges=${graphResult.edgeCount}, elapsedMs=${graphResult.elapsedMs}`,
        );
      } else {
        console.warn("[review] Graph result was null, using dep-map");
      }
    } catch (graphError) {
      const msg =
        graphError instanceof Error ? graphError.message : String(graphError);
      console.warn(`[review] Graph generation failed (${msg}), using dep-map`);
      notes.push(`Codebase graph unavailable: ${msg.slice(0, 200)}`);
    }

    // ─── Phase 2: Route skills + harvest evidence (v2 pipeline) ───
    let evidenceStore: EvidenceStore | undefined;
    let skillFindings: Array<{
      skillName: string;
      findings: import("./v2/types").V2ReviewFinding[];
    }> = [];

    if (depMap && depMap.nodes.length > 0) {
      try {
        const skillsFromDb = options.skills ?? [];
        const hasSecurityContent =
          classification.shouldRunSecurity ||
          hasSecurityFiles ||
          securityMap.some((s) => s.riskNotes.length > 0);
        const hardcodedSkills: SkillDefinition[] = [];

        if (hasSecurityContent) {
          hardcodedSkills.push({
            name: "security-review",
            description:
              "Security vulnerability analysis (IDOR, XSS, auth bypass, injection, CSRF, SSRF, mass assignment, webhook HMAC)",
            location: "hardcoded",
            content: getSecuritySkillContent(),
            triggers: {
              tags: ["auth", "security", "api"],
              filePatterns: ["**/api/**", "**/route.ts"],
              symbolPatterns: [],
            },
          });
        }

        if (classification.shouldRunLogic) {
          hardcodedSkills.push({
            name: "logic-review",
            description:
              "Behavioral correctness, race conditions, error handling, null safety, contract analysis",
            location: "hardcoded",
            content: getLogicSkillContent(),
            triggers: { tags: ["core"], filePatterns: [], symbolPatterns: [] },
          });
        }

        if (hardcodedSkills.length > 0 || skillsFromDb.length > 0) {
          const allSkills: SkillDefinition[] = [
            ...hardcodedSkills,
            ...(skillsFromDb.length > 0
              ? skillsFromDb.map((s) => ({
                  name: s.name,
                  description: s.description || s.useCase,
                  location: "db",
                  content: s.content,
                  triggers: { tags: [], filePatterns: [], symbolPatterns: [] },
                }))
              : []),
          ];

          const routed = routeSkills({
            dependencyMap: depMap,
            skills: allSkills,
            maxSkills: 3,
          });
          if (routed.length > 0) {
            console.log(
              `[review] Routes ${routed.length} skills: ${routed.map((r) => `${r.skill.name}(${r.score})`).join(", ")}`,
            );

            evidenceStore = await harvestEvidence({
              sandboxManager: manager,
              sandboxId: sandbox.id,
              dependencyMap: depMap,
              routedSkills: routed,
              changedFiles: branchCtx.changedFiles,
              patchesByFile,
              diffFailures: [],
            }).catch(() => new EvidenceStore());

            const workerResults = await Promise.all(
              routed.map((routedSkill) =>
                runSkillWorker({
                  model: cheapModel,
                  skill: routedSkill,
                  dependencyMap: depMap ?? {
                    nodes: [],
                    edges: [],
                    tags: [],
                    hotFiles: [],
                    topSymbols: [],
                    summary: [],
                  },
                  evidenceStore: evidenceStore ?? new EvidenceStore(),
                  maxFindingsPerSkill: 8,
                }).then((findings) => ({
                  skillName: routedSkill.skill.name,
                  findings,
                })),
              ),
            );
            skillFindings = workerResults.flat();
            const totalSkillFindings = skillFindings.reduce(
              (s, f) => s + f.findings.length,
              0,
            );
            console.log(
              `[review] Skill workers: ${totalSkillFindings} findings from ${routed.length} skills`,
            );
            for (const sf of skillFindings) {
              partialFindings.push(
                ...sf.findings.map((f) => ({
                  severity: f.severity,
                  file: f.file ?? "unknown",
                  line: f.line,
                  quote: f.quote,
                  title: f.title,
                  message: f.message,
                  suggestion: f.suggestion,
                })),
              );
            }
          }
        }
      } catch (skillErr) {
        console.warn(
          "[review] Skill pipeline failed:",
          skillErr instanceof Error ? skillErr.message : String(skillErr),
        );
      }
    }

    // ─── Phase 3: Fan-out sub-agents (if >30 files) ───
    let subFindingsPrompt = "";
    let allSubAgentFindings: V2ReviewFinding[] = [];

    if (hasSubFindings) {
      console.log(
        `[review] FAN-OUT MODE: ${files.length} files exceeds threshold of ${threshold}`,
      );

      const subResults = await runSubReviews({
        model: cheapModel,
        files,
        batchSize: 15,
        dependencyNodes: depNodes,
        dependencyEdges: depEdges,
        securityContext: securityMap,
        sandboxManager: manager,
        sandboxId: sandbox.id,
      });

      allSubAgentFindings = mergeSubFindings(subResults);

      for (const f of allSubAgentFindings) {
        partialFindings.push({
          severity: f.severity,
          file: f.file ?? "unknown",
          line: f.line,
          quote: f.quote,
          title: f.title,
          message: f.message,
          suggestion: f.suggestion,
        });
      }

      if (allSubAgentFindings.length >= 3) {
        try {
          const crossRefResult = await runCrossReference({
            model: cheapModel,
            subFindings: allSubAgentFindings,
            dependencyMap: depMap,
            totalChangedFiles: files.length,
            totalBatches: subResults.length,
          });
          allSubAgentFindings.splice(
            0,
            allSubAgentFindings.length,
            ...crossRefResult.findings,
          );
          if (crossRefResult.missedCount > 0)
            notes.push(
              `Cross-ref detected ${crossRefResult.missedCount} potentially missed issues.`,
            );
          if (crossRefResult.contradictoryPairs.length > 0)
            notes.push(
              `Cross-ref detected ${crossRefResult.contradictoryPairs.length} contradictory finding pairs.`,
            );
        } catch (crossErr) {
          console.warn(
            "[review] Cross-ref failed:",
            crossErr instanceof Error ? crossErr.message : String(crossErr),
          );
        }
      }

      subFindingsPrompt = buildSubFindingsPrompt(allSubAgentFindings);
      if (dependencyContext)
        subFindingsPrompt = `${dependencyContext}\n\n---\n\n${subFindingsPrompt}`;
      console.log(
        `[review] FAN-OUT DONE: ${allSubAgentFindings.length} findings`,
      );
    } else {
      console.log(
        `[review] SINGLE-AGENT MODE: ${files.length} files (threshold=${threshold})`,
      );
    }

    // ─── Build context for main agent ───
    const initialDiff =
      input.initialDiff ??
      (files.length > 0
        ? files
            .map((f) => {
              return [
                `diff --git a/${f.path} b/${f.path}`,
                `--- a/${f.path}`,
                `+++ b/${f.path}`,
                f.patch,
              ].join("\n");
            })
            .join("\n\n")
        : "");

    const securityContextStr =
      securityMap.length > 0
        ? [
            "",
            "## PRECOMPUTED SECURITY CONTEXT (per route analysis)",
            "",
            ...securityMap.map(
              (s) =>
                `### ${s.filePath}` +
                `\n- Auth: ${s.hasAuth ? `YES (${s.authFunction ?? "present"})` : "NONE — P0 RISK"}` +
                `\n- Webhook: ${s.isWebhook ? `YES (HMAC: ${s.hasHmacVerification ? "verified" : "NONE — P0 RISK"})` : "No"}` +
                `\n- XSS: ${s.hasDangerouslySetInnerHTML ? "YES — CHECK SANITIZATION" : "No"}` +
                `\n- Queries: ${s.queries.length > 0 ? s.queries.map((q) => `\`prisma.${q.model}.${q.type}\` (where: ${q.whereFields.join(", ")}) — ${q.hasUserScoping ? "user-scoped" : "NO USER SCOPING"}`).join("; ") : "None"}` +
                (s.riskNotes.length > 0
                  ? `\n- Risk notes: ${s.riskNotes.join("; ")}`
                  : ""),
            ),
            "",
            "Validate each security context finding against the actual codebase. Report any missed issues as P0.",
          ].join("\n")
        : "";

    const skillFindingsStr =
      skillFindings.length > 0
        ? [
            "",
            "## SKILL WORKER FINDINGS",
            ...skillFindings.flatMap((sf) =>
              sf.findings.map(
                (f) =>
                  `  [${sf.skillName}] [${f.severity}] ${f.file ?? "?"}:${f.line ?? "?"} — ${f.title}`,
              ),
            ),
            "",
          ].join("\n")
        : "";

    const multiSourceContext = [
      subFindingsPrompt,
      skillFindingsStr,
      securityContextStr,
    ]
      .filter(Boolean)
      .join("\n");

    // ─── Phase 3: Main agent validation ───
    const baseStepCap = options.maxToolSteps ?? 24;
    const extendedStepCap = hasSubFindings
      ? Math.max(baseStepCap + 12, 36)
      : baseStepCap;
    const minSteps = 5;

    console.log(
      `[review] Main agent — maxSteps=${extendedStepCap}, minSteps=${minSteps}, graphAvailable=${graphAvailable}, multiSourceContext=${multiSourceContext.length > 0}`,
    );

    let review = await runReviewAgent(input.headRef, {
      model: mainModel,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      initialDiff,
      diffSummary: input.diffSummary,
      defaultBranch: input.baseRef,
      maxFindings: options.maxFindings ?? 200,
      maxToolSteps: options.maxToolSteps ?? 24,
      minToolSteps: options.minToolSteps ?? 5,
      signal: options.signal,
      graphPath: effectiveGraphPath,
      skills: options.skills,
      subFindingsContext: multiSourceContext || undefined,
    });

    const hasOnlyLowSeverityFindings =
      review.findings.length > 0 &&
      review.findings.every((f) => f.severity === "P3" || f.severity === "P4");

    const hasSecurityFilesFlag = files.some(
      (f) =>
        f.path.includes("/api/") ||
        f.path.endsWith("route.ts") ||
        f.path.endsWith("route.tsx") ||
        f.path.includes("/auth/") ||
        f.path.includes("/webhooks/"),
    );

    const needsRetry =
      (review.findings.length === 0 &&
        (hasSubFindings ||
          securityMap.length > 0 ||
          skillFindings.length > 0)) ||
      (hasOnlyLowSeverityFindings && (hasSecurityFilesFlag || hasSubFindings));

    if (needsRetry) {
      const retryReason =
        review.findings.length === 0
          ? "Main agent returned 0 findings with sub-context"
          : `Main agent returned only low/info findings on security-critical files`;
      console.log(`[review] ${retryReason} — running validation re-query...`);
      const retryPrompt = [
        multiSourceContext,
        "",
        "CRITICAL: Your initial review had significant gaps.",
        review.findings.length === 0
          ? "You returned 0 findings. The specialized agents above reported issues."
          : "You returned only low-severity findings on files tagged as security-critical (API routes, auth).",
        "Please explicitly:",
        "1. Validate each finding from specialized agents against the codebase using readFile (confirm, reject, or adjust severity).",
        "2. For every API route file, read the full file and verify authentication + query user-scoping.",
        "3. Explain why each finding was rejected if you disagree with it.",
        "4. Add any missed findings, especially security issues.",
        "5. Output a JSON with at minimum the validated findings from specialized agents.",
        "",
        "If ALL findings were false positives, output them but set severity to 'info' and explain in each message why they were rejected.",
      ].join("\n");

      review = await runReviewAgent(input.headRef, {
        model: mainModel,
        sandboxManager: manager,
        sandboxId: sandbox.id,
        initialDiff,
        diffSummary: input.diffSummary,
        defaultBranch: input.baseRef,
        maxFindings: options.maxFindings ?? 20,
        maxToolSteps: Math.max(extendedStepCap, 30),
        minToolSteps: Math.max(minSteps + 3, 8),
        signal: options.signal,
        graphPath: effectiveGraphPath,
        skills: options.skills,
        subFindingsContext: retryPrompt,
      });

      if (review.findings.length === 0) {
        console.log(
          "[review] Re-query also returned 0 findings — agent genuinely found no issues to report",
        );
        notes.push(
          "Main agent validated all sub-agent findings and found none that required reporting against the actual codebase.",
        );
      } else {
        const newCount = review.findings.length;
        const hasSecurityIssues = review.findings.some(
          (f) => f.severity === "P0" || f.severity === "P1",
        );
        console.log(
          `[review] Re-query recovered ${newCount} findings${hasSecurityIssues ? " including security issues" : ""}`,
        );
        notes.push(
          `Initial agent pass returned ${needsRetry && review.findings.length > 0 ? "only low-severity" : "0"} findings; re-query recovered ${newCount} findings${hasSecurityIssues ? " (security issues detected)" : ""}.`,
        );
      }
    }

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;
    const modelName = process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

    return {
      summary: buildSummary(findings, modelName, elapsedMs),
      findings,
      agentSummaries: review.agentSummaries,
    };
  } catch (error) {
    console.error("Error during pull request review", {
      error,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    const hasPartialFindings = partialFindings.length > 0;
    const hasP0OrP1 = partialFindings.some(
      (f) => f.severity === "P0" || f.severity === "P1",
    );

    return {
      summary: {
        verdict: hasP0OrP1 ? "request_changes" : "comment",
        score: hasPartialFindings ? scoreFromFindings(partialFindings) : 0,
        overview: hasPartialFindings
          ? `Review failed with error but ${partialFindings.length} partial findings were recovered. Error: ${errorMessage}`
          : `An error occurred during the review process: ${errorMessage}`,
        risk: hasP0OrP1 ? "high" : "unknown",
        model: process.env.REVIEW_MODEL ?? "gpt-5.4-mini",
        elapsedMs: Date.now() - startedAt,
      },
      findings: hasPartialFindings ? partialFindings : [],
      notes: [
        `The review agent encountered an error and could not complete the review.`,
        `Error details: ${errorMessage}`,
        ...(hasPartialFindings
          ? [
              `${partialFindings.length} partial findings from skill workers / sub-agents are included.`,
            ]
          : []),
      ],
    };
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}

import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runMechanicAgent } from "./mechanic-agent";
import type { FixResult } from "./schema/fix-result";
import type {
  MechanicRepoInput,
  MechanicAgentOptions,
  SentryIssueContext,
} from "./types";
import type { LanguageModel } from "ai";

export interface SentryFixInput {
  issue: SentryIssueContext;
  repo: MechanicRepoInput;
  eventJson?: string;
}

export interface SentryFixResult {
  success: boolean;
  fix?: FixResult;
  prUrl?: string;
  branchName?: string;
  error?: string;
}

function buildSentryContextPrompt(input: SentryFixInput): string {
  const { issue, eventJson } = input;
  const lines: string[] = [
    `## Sentry Error Report`,
    ``,
    `Title: ${issue.title}`,
    `Level: ${issue.level}`,
    `Status: ${issue.status}`,
    `Events: ${issue.count}`,
    `Users affected: ${issue.userCount}`,
    `Culprit: ${issue.culprit}`,
    `First seen: ${issue.firstSeen}`,
    `Last seen: ${issue.lastSeen}`,
    `Permalink: ${issue.permalink}`,
    ``,
  ];

  if (eventJson) {
    lines.push(`## Latest Event`, ``);
    try {
      const event = JSON.parse(eventJson);
      const entry = event.entries?.find(
        (e: { type: string }) => e.type === "exception",
      );
      if (entry) {
        const values = entry.data?.values ?? [];
        for (const value of values) {
          if (value.type) {
            lines.push(`Exception type: ${value.type}`);
          }
          if (value.value) {
            lines.push(`Exception message: ${value.value}`);
          }
          if (value.stacktrace?.frames) {
            lines.push(``, `Stacktrace:`, ``);
            for (const frame of value.stacktrace.frames.slice(0, 20)) {
              const line = frame.lineNo ?? 0;
              const col = frame.colNo ?? 0;
              lines.push(
                `  ${frame.filename}:${line}:${col} — ${frame.function ?? "(anonymous)"}`,
              );
              if (frame.context) {
                for (const [ctxLine, ctxCode] of frame.context) {
                  const marker = ctxLine === line ? ">" : " ";
                  lines.push(`  ${marker} ${ctxLine}: ${ctxCode}`);
                }
              }
            }
          }
        }
      }

      const breadcrumbs = event.entries?.find(
        (e: { type: string }) => e.type === "breadcrumbs",
      );
      if (breadcrumbs?.data?.values?.length > 0) {
        lines.push(``, `Breadcrumbs:`, ``);
        for (const crumb of breadcrumbs.data.values.slice(-10)) {
          lines.push(
            `  ${crumb.timestamp ?? ""} [${crumb.category ?? ""}] ${crumb.message ?? ""}`,
          );
        }
      }

      const request = event.request ?? event.contexts?.request;
      if (request) {
        lines.push(``, `Request:`, ``);
        if (request.url) lines.push(`  URL: ${request.url}`);
        if (request.method) lines.push(`  Method: ${request.method}`);
      }
    } catch {
      lines.push(`(raw event data could not be parsed)`);
    }
  }

  lines.push(``, `## Task`, ``);
  lines.push(`Find the root cause of this error in the codebase and fix it.`);
  lines.push(`Repository: ${input.repo.owner}/${input.repo.repo}`);
  lines.push(`Default branch: ${input.repo.defaultBranch ?? "main"}`);

  return lines.join("\n");
}

export async function runSentryFix(
  input: SentryFixInput,
  options: MechanicAgentOptions = {},
): Promise<SentryFixResult> {
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
  if (!copilotToken) {
    return {
      success: false,
      error: "Missing COPILOT_GITHUB_TOKEN",
    };
  }

  const modelName =
    options.modelName ?? process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
  });
  const model = provider(modelName);

  let githubClient;
  let token: string;
  try {
    githubClient = await getGitHubClient(input.repo.installationId);
    const auth = await githubClient.rest.apps.createInstallationAccessToken({
      installation_id: input.repo.installationId,
    });
    token = auth.data.token;
  } catch (error) {
    return {
      success: false,
      error: `Failed to authenticate with GitHub: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const vercelProvider = new VercelSandboxProvider();
  const manager = SandboxManager.getInstance({
    provider: vercelProvider,
    logger: console,
  });

  let sandbox;
  try {
    sandbox = await manager.createSandbox({
      ownerId: "mechanic-agent",
      source: {
        type: "git",
        url:
          options.repositoryUrl ??
          `https://github.com/${input.repo.owner}/${input.repo.repo}.git`,
        username: "x-access-token",
        password: token,
      },
    });
  } catch (error) {
    return {
      success: false,
      error: `Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const startedAt = Date.now();

  try {
    const cwdResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
    });
    const workingDir = cwdResult.stdout.trim() || "/home/user";
    const graphPath = `${workingDir}/codebase-graph.json`;

    const sentryContextPrompt = buildSentryContextPrompt(input);

    const fix = await runMechanicAgent({
      model,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      sentryContextPrompt,
      maxToolSteps: options.maxToolSteps ?? 20,
      minToolSteps: options.minToolSteps ?? 5,
      signal: options.signal,
      graphPath,
      workingDir,
    });

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[sentry-fix] Fix completed in ${elapsedMs}ms, confident=${fix.confident}, verificationPassed=${fix.verificationPassed}, filesChanged=${fix.filesChanged.length}`,
    );

    console.log("[sentry-fix] Running git diff to detect changes...");
    const diffResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "git",
      args: ["diff"],
    });
    const diffOutput = diffResult.stdout ?? "";
    console.log(
      `[sentry-fix] git diff length: ${diffOutput.length}, exitCode: ${diffResult.exitCode}`,
    );

    if (!diffOutput.trim()) {
      const statusResult = await manager.runCommand({
        sandboxId: sandbox.id,
        command: "git",
        args: ["status", "--porcelain"],
      });
      console.log(
        `[sentry-fix] git status: ${(statusResult.stdout ?? "").trim() || "(clean)"}`,
      );

      return {
        success: true,
        fix,
        error: "Agent completed but no changes were detected in the sandbox.",
      };
    }

    console.log(
      "[sentry-fix] Changes detected, proceeding to git branch/commit/push...",
    );

    const shortId = input.issue.id.slice(0, 8);
    const branchName = `fix/sentry-${shortId}`;

    console.log(`[sentry-fix] Setting git remote with auth token...`);
    const encodedToken = encodeURIComponent(token);
    const authUrl = `https://x-access-token:${encodedToken}@github.com/${input.repo.owner}/${input.repo.repo}.git`;
    const remoteResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "git",
      args: ["remote", "set-url", "origin", authUrl],
    });
    console.log(
      `[sentry-fix] Remote set-url: exitCode=${remoteResult.exitCode}`,
    );

    console.log(`[sentry-fix] Setting git user config...`);
    await manager.runCommand({
      sandboxId: sandbox.id,
      command: "git",
      args: [
        "config",
        "user.email",
        "mechanic-agent[bot]@users.noreply.github.com",
      ],
    });
    await manager.runCommand({
      sandboxId: sandbox.id,
      command: "git",
      args: ["config", "user.name", "Mechanic Agent"],
    });

    console.log(`[sentry-fix] Creating branch: ${branchName}`);
    try {
      const branchResult = await manager.runCommand({
        sandboxId: sandbox.id,
        command: "git",
        args: ["checkout", "-b", branchName],
      });
      console.log(
        `[sentry-fix] Branch created: exitCode=${branchResult.exitCode}`,
      );

      const addResult = await manager.runCommand({
        sandboxId: sandbox.id,
        command: "git",
        args: ["add", "-A"],
      });
      console.log(`[sentry-fix] Git add: exitCode=${addResult.exitCode}`);

      const commitResult = await manager.runCommand({
        sandboxId: sandbox.id,
        command: "git",
        args: [
          "commit",
          "-m",
          `fix: ${input.issue.title}

Sentry issue: ${input.issue.permalink}

${fix.rootCause}`,
        ],
      });
      console.log(
        `[sentry-fix] Git commit: exitCode=${commitResult.exitCode}, stdout=${commitResult.stdout?.trim()}`,
      );

      const pushResult = await manager.runCommand({
        sandboxId: sandbox.id,
        command: "git",
        args: ["push", "origin", branchName],
      });
      const pushStderr = (pushResult.stderr ?? "").replace(
        /x-access-token:[^@]+@/g,
        "x-access-token:***@",
      );
      console.log(
        `[sentry-fix] Git push: exitCode=${pushResult.exitCode}, stderr=${pushStderr.slice(0, 1000)}`,
      );

      if (pushResult.exitCode !== 0) {
        return {
          success: true,
          fix,
          error: `Git push failed (exit ${pushResult.exitCode}): ${pushStderr.slice(0, 500)}`,
        };
      }
    } catch (error) {
      console.error("[sentry-fix] Git operations failed", error);
      return {
        success: true,
        fix,
        error: `Fix was applied but git operations failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    console.log("[sentry-fix] Creating pull request...");

    const prBody = [
      `## Fix for Sentry Issue`,
      ``,
      `**Issue**: ${input.issue.title}`,
      `**Level**: ${input.issue.level}`,
      `**Permalink**: ${input.issue.permalink}`,
      ``,
      `### Root Cause`,
      ``,
      fix.rootCause,
      ``,
      `### Summary`,
      ``,
      fix.summary,
      ``,
      `### Files Changed`,
      ``,
      ...fix.filesChanged.map((f) => `- \`${f.path}\`: ${f.description}`),
      ``,
      `### Verification`,
      ``,
      `Lint/typecheck passed: ${fix.verificationPassed ? "✅" : "❌"}`,
      fix.verificationNotes ? `\n\`\`\`\n${fix.verificationNotes}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const pr = await githubClient.rest.pulls.create({
        owner: input.repo.owner,
        repo: input.repo.repo,
        title: `fix: ${input.issue.title}`,
        head: branchName,
        base: input.repo.defaultBranch ?? "main",
        body: prBody,
        draft: true,
      });

      console.log(`[sentry-fix] PR created: ${pr.data.html_url}`);
      return {
        success: true,
        fix,
        prUrl: pr.data.html_url,
        branchName,
      };
    } catch (error) {
      console.error("[sentry-fix] PR creation failed", error);
      return {
        success: true,
        fix,
        branchName,
        error: `Fix pushed to ${branchName} but PR creation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    console.error("[sentry-fix] Error during fix process", { error });
    return {
      success: false,
      error: `Fix agent encountered an error: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}

import { createReviewModel } from "@pfe-monorepo/opencode-go-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgent } from "../review-agent";
import { generateCodebaseGraph } from "../graph-generator";
import {
  getUsageTelemetry,
  resetUsageTelemetry,
} from "../telemetry/usage-telemetry";

const INSTALLATION_ID = 115597577;
const OWNER = "speyar";
const REPO = "pfe-monorepo";
const PR_NUMBER = 99;

const INPUT_PRICE_PER_1M = 5;
const OUTPUT_PRICE_PER_1M = 15;

async function fetchPullRequestDiff(): Promise<{
  headRef: string;
  baseRef: string;
  diffText: string;
}> {
  const github = await getGitHubClient(INSTALLATION_ID);
  const pr = await github.rest.pulls.get({
    owner: OWNER,
    repo: REPO,
    pull_number: PR_NUMBER,
  });

  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: OWNER,
    repo: REPO,
    pull_number: PR_NUMBER,
    per_page: 100,
  });

  const diffText = files
    .filter((file) => typeof file.patch === "string" && file.patch.length > 0)
    .map((file) => {
      const path = file.filename;
      return [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        file.patch,
      ].join("\n");
    })
    .join("\n\n");

  return {
    headRef: pr.data.head.ref,
    baseRef: pr.data.base.ref,
    diffText,
  };
}

async function main(): Promise<void> {
  if (!process.env.OPENCODEGO_API_KEY) {
    throw new Error("Missing OPENCODEGO_API_KEY in environment.");
  }

  const prData = await fetchPullRequestDiff();
  resetUsageTelemetry();

  const model = createReviewModel(
    process.env.OPENCODEGO_MODEL ?? "deepseek-v4-flash",
  );

  const github = await getGitHubClient(INSTALLATION_ID);
  const {
    data: { token },
  } = await github.rest.apps.createInstallationAccessToken({
    installation_id: INSTALLATION_ID,
  });

  const manager = SandboxManager.getInstance({
    provider: new VercelSandboxProvider(),
    logger: console,
  });

  const sandbox = await manager.createSandbox({
    ownerId: "measure-pr99",
    source: {
      type: "git",
      url: `https://github.com/${OWNER}/${REPO}.git`,
      username: "x-access-token",
      password: token,
    },
  });

  const startedAt = Date.now();
  let findings = 0;

  try {
    const cwdResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
    });
    const workingDir = cwdResult.stdout.trim() || "/home/user";
    const graphPath = `${workingDir}/codebase-graph.json`;

    const graph = await generateCodebaseGraph(manager, sandbox.id, {
      rootPath: workingDir,
      outPath: graphPath,
      pretty: true,
    });

    const review = await runReviewAgent(prData.headRef, {
      model: model as any,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      initialDiff: prData.diffText,
      defaultBranch: prData.baseRef,
      maxFindings: 200,
      maxToolSteps: 24,
      minToolSteps: 5,
      graphPath: graph.graphPath,
      providerOptions: {
        "opencode-go": {
          reasoningEffort: "high",
        },
      },
    });

    findings = review.findings.length;
  } finally {
    await manager.stopSandbox(sandbox.id);
  }

  const elapsedMs = Date.now() - startedAt;
  const usage = getUsageTelemetry();
  const estimatedCostUsd =
    (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_1M +
    (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_1M;

  const result = {
    pr: `${OWNER}/${REPO}#${PR_NUMBER}`,
    findings,
    elapsedSeconds: Math.round(elapsedMs / 1000),
    usage,
    pricingAssumption: {
      inputPer1M: INPUT_PRICE_PER_1M,
      outputPer1M: OUTPUT_PRICE_PER_1M,
      currency: "USD",
    },
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

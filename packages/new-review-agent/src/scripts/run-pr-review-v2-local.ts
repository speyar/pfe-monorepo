import { runPullRequestReviewV2 } from "../pull-request-review-v2";
import { runReviewAgentV2 } from "../review-agent-v2";
import type { SandboxManager } from "@packages/sandbox";

function parseArgs(argv: string[]): {
  owner: string;
  repo: string;
  pr: number;
  installationId: number;
  modelName?: string;
  mode: "remote" | "local";
  headRef?: string;
  baseRef?: string;
  sandboxId?: string;
  sandboxRepoUrl?: string;
  sandboxOwnerId?: string;
} {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }
    args.set(key, value);
    i += 1;
  }

  const owner = args.get("owner") ?? "speyar";
  const repo = args.get("repo") ?? "pfe-monorepo";
  const pr = Number.parseInt(args.get("pr") ?? "45", 10);
  const installationId = Number.parseInt(
    args.get("installation") ?? "120638931",
    10,
  );
  const modelName = args.get("model");
  const modeValue = args.get("mode") ?? "remote";
  const mode: "remote" | "local" = modeValue === "local" ? "local" : "remote";
  const headRef = args.get("head");
  const baseRef = args.get("base");
  const sandboxId = args.get("sandbox");
  const sandboxRepoUrl = args.get("sandbox-repo-url");
  const sandboxOwnerId = args.get("sandbox-owner-id") ?? "local-replay";

  if (!Number.isFinite(pr) || pr < 1) {
    throw new Error("Invalid --pr value");
  }
  if (!Number.isFinite(installationId) || installationId < 1) {
    throw new Error("Invalid --installation value");
  }

  return {
    owner,
    repo,
    pr,
    installationId,
    modelName,
    mode,
    headRef,
    baseRef,
    sandboxId,
    sandboxRepoUrl,
    sandboxOwnerId,
  };
}

async function getPrRefs(input: {
  installationId: number;
  owner: string;
  repo: string;
  pr: number;
}): Promise<{ headRef: string; baseRef: string }> {
  const { getGitHubClient } = await import("@pfe-monorepo/github-api");
  const client = await getGitHubClient(input.installationId);
  const response = await client.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pr,
  });

  return {
    headRef: response.data.head.ref,
    baseRef: response.data.base.ref,
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
  if (!copilotToken) {
    throw new Error("Missing COPILOT_GITHUB_TOKEN");
  }

  const { createOpenaiCompatible } =
    await import("@ceira/better-copilot-provider");
  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
  });

  const modelName =
    parsed.modelName ?? process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

  const { SandboxManager, VercelSandboxProvider } =
    await import("@packages/sandbox");
  const manager = SandboxManager.getInstance({
    provider: new VercelSandboxProvider(),
    logger: console,
  });

  const runAgainstSandbox = async (input: {
    sandboxManager: SandboxManager;
    sandboxId: string;
    headRef: string;
    baseRef: string;
    label: string;
  }) => {
    const started = Date.now();
    const review = await runReviewAgentV2(input.headRef, {
      model: provider(modelName),
      sandboxManager: input.sandboxManager,
      sandboxId: input.sandboxId,
      defaultBranch: input.baseRef,
      maxFindings: 20,
      maxSkillWorkers: 4,
    });
    const finished = Date.now();
    console.log(`=== ${input.label} ===`);
    console.log(`sandbox: ${input.sandboxId}`);
    console.log(`head/base: ${input.headRef} <- ${input.baseRef}`);
    console.log(`elapsed_ms: ${finished - started}`);
    console.log(JSON.stringify(review, null, 2));
  };

  if (parsed.mode === "local") {
    let sandboxId = parsed.sandboxId;
    if (!sandboxId) {
      if (!parsed.sandboxRepoUrl) {
        throw new Error(
          "Local mode requires either --sandbox <id> or --sandbox-repo-url <git-url>",
        );
      }
      const sandbox = await manager.createSandbox({
        ownerId: parsed.sandboxOwnerId,
        source: {
          type: "git",
          url: parsed.sandboxRepoUrl,
        },
      });
      sandboxId = sandbox.id;
    }

    if (!parsed.headRef || !parsed.baseRef) {
      throw new Error("Local mode requires --head <branch> --base <branch>");
    }

    await runAgainstSandbox({
      sandboxManager: manager,
      sandboxId,
      headRef: parsed.headRef,
      baseRef: parsed.baseRef,
      label: "Local Workspace Review V2 Replay",
    });
    return;
  }

  if (parsed.mode === "remote") {
    const remoteWithAgent = process.env.LOCAL_REPLAY_INSTALLATION_ID;
    if (remoteWithAgent) {
      console.warn(
        "Using standard remote mode via GitHub installation token path.",
      );
    }
  }

  const refs = await getPrRefs({
    installationId: parsed.installationId,
    owner: parsed.owner,
    repo: parsed.repo,
    pr: parsed.pr,
  });

  const started = Date.now();
  const review = await runPullRequestReviewV2(
    {
      installationId: parsed.installationId,
      owner: parsed.owner,
      repo: parsed.repo,
      headRef: refs.headRef,
      baseRef: refs.baseRef,
    },
    {
      modelName,
      maxFindings: 20,
      maxSkillWorkers: 4,
    },
  );

  const finished = Date.now();

  console.log("=== Local PR Review V2 Replay ===");
  console.log(`repo: ${parsed.owner}/${parsed.repo}`);
  console.log(`pr: #${parsed.pr}`);
  console.log(`head/base: ${refs.headRef} <- ${refs.baseRef}`);
  console.log(`elapsed_ms: ${finished - started}`);
  console.log(JSON.stringify(review, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { runReviewAgent } from "./index";

async function main() {
  const apiKey =
    process.env.OPENCODEGO_API_KEY ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing OPENCODEGO_API_KEY (or GH_TOKEN / GITHUB_TOKEN / OPENAI_API_KEY).",
    );
  }

  const model = createOpenCodeGoModel(process.env.OPENCODEGO_MODEL ?? "kimi-k2.5", { apiKey });

  // const client = await getGitHubClient(120638931);
  const client = await getGitHubClient(115597577);
  const {
    data: { token },
  } = await client.rest.apps.createInstallationAccessToken({
    installation_id: 115597577,
  });

  const vercelProvider = new VercelSandboxProvider();
  const manager = SandboxManager.getInstance({
    provider: vercelProvider,
    logger: console,
  });

  const sandbox = await manager.createSandbox({
    ownerId: "test-owner",
    source: {
      type: "git",
      // url: "https://github.com/speyar/pfe-monorepo.git",
      url: "https://github.com/BenyounesMehdi/CodeAlchemy.git",
      username: "x-access-token",
      password: token,
    },
  });

  try {
    const result = await runReviewAgent("react", {
      model,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      defaultBranch: "main",
      maxFindings: 20,
      maxToolSteps: 24,
      minToolSteps: 5,
    });

    console.log("Review Result:", JSON.stringify(result, null, 2));
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

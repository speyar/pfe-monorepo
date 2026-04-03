import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { runReviewAgent } from "./index";

async function main() {
  const provider = createGitHubCopilotProvider({
    clientOptions: {
      logLevel: "debug",
    },
    builtInTools: "all",
  });

  const client = await getGitHubClient(120638931);
  const {
    data: { token },
  } = await client.rest.apps.createInstallationAccessToken({
    installation_id: 120638931,
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
      url: "https://github.com/speyar/pfe-monorepo.git",
      username: "x-access-token",
      password: token,
    },
  });

  try {
    const result = await runReviewAgent("feature-branch", {
      model: provider("gpt-4.1"),
      sandboxManager: manager,
      sandboxId: sandbox.id,
      maxToolSteps: 15,
    });

    console.log("Review Result:", JSON.stringify(result, null, 2));
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}

main();

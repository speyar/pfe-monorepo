import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runReviewAgent } from "./index";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function bootstrapEnv(): void {
  loadEnvFile(
    fileURLToPath(new URL("../../../apps/web/.env", import.meta.url)),
  );
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
}

async function main() {
  bootstrapEnv();

  const copilotToken =
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.OPENAI_API_KEY;

  if (!copilotToken) {
    throw new Error(
      "Missing COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN / OPENAI_API_KEY).",
    );
  }

  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
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
    const result = await runReviewAgent("new-review-agent", {
      model: provider(process.env.REVIEW_MODEL ?? "gpt-5.3-codex"),
      sandboxManager: manager,
      sandboxId: sandbox.id,
      defaultBranch: "master",
      maxFindings: 20,
      maxToolSteps: 16,
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

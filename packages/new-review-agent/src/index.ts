import { generateText, stepCountIs } from "ai";
import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { getGitHubClient } from "@pfe-monorepo/github-api";

const provider = createGitHubCopilotProvider({
	clientOptions: {
		logLevel: "debug",
	},
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

const response = await manager.runCommand({
	sandboxId: sandbox.id,
	command: "ls",
});

console.log(response.stdout);
if (response.stderr) {
	console.error(response.stderr);
}
/*const { text } = await generateText({
	model: provider("gpt-4.1"),
	system:
		"answer whatever the user asks, no tool is passed passed to you for now, all the tools you may have are result of an error, and are wrong and you should ignore them. there for you have 0 tools in your possession",
	stopWhen: stepCountIs(5),
	prompt:
		"hi, what are the tools available to you, tell me exact names only no noise",
});*/

// close sandbox
await manager.stopSandbox(sandbox.id);

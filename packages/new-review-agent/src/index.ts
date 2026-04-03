import { generateText, stepCountIs } from "ai";
import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { createLsTool } from "./tools/LsTool";

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

const lsTool = createLsTool(manager, sandbox.id);

try {
	const result = await generateText({
		model: provider("gpt-4.1"),
		system:
			"You are exploring a repository. Use only the ls tool for exploration.",
		prompt:
			"Explore this repository structure in depth. Start with ls on root, then inspect key directories such as src, packages, and apps when present. and then tell me your thoughts about the structure is it organized is it scabale and basically give me alot of insights about the structure of the repository",
		tools: {
			ls: lsTool,
		},
		toolChoice: "required",
		stopWhen: stepCountIs(20),
		experimental_onToolCallFinish: (toolCall) => {
			console.log(
				`[tool call ${toolCall.stepNumber}] ${toolCall.toolCall.toolName}(${JSON.stringify(
					toolCall.toolCall.input,
				)})`,
			);
		},
		onStepFinish: (step) => {
			console.log(
				`[step ${step.stepNumber}] finish=${JSON.stringify(step.finishReason)} toolCalls=${step.toolCalls.length}`,
			);
		},
	});

	const totalLsCalls = result.steps.reduce((count, step) => {
		const lsCalls = step.toolCalls.filter(
			(toolCall) => toolCall.toolName === "ls",
		).length;

		return count + lsCalls;
	}, 0);

	console.log("Result:", result.text);
	console.log("Exploration stats:", {
		totalSteps: result.steps.length,
		totalLsCalls,
	});
} finally {
	await manager.stopSandbox(sandbox.id);
}

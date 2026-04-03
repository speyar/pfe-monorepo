import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { generateText } from "ai";

const copilotToken =
	process.env.COPILOT_GITHUB_TOKEN ??
	process.env.GH_TOKEN ??
	process.env.GITHUB_TOKEN ??
	process.env.OPENAI_API_KEY;

const provider = createOpenaiCompatible({
	apiKey: copilotToken,
	baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
	name: "copilot",
});

const generation = await generateText({
	model: provider("gpt-4.1"),
	system: "Your name is lulu",
	prompt: "What's your name?",
});

console.log(generation.text);
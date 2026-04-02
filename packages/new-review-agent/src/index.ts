import { generateText } from "ai";
import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";

const provider = createGitHubCopilotProvider();

const { text } = await generateText({
  model: provider("gpt-5.3-codex"),
  system: "answer whatever the user asks",
  prompt: "hi, what are the tools available to you",
});

console.log(text);

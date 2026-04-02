import { generateText } from "ai";
import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";

const provider = createGitHubCopilotProvider({
  builtInTools: "none"
});

const { text } = await generateText({
  model: provider("gpt-4.1"),
  system: "answer whatever the user asks",
  prompt: "hi, what are the tools available to you",
});

console.log(text);

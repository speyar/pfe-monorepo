import { generateText, stepCountIs } from "ai";
import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";

const provider = createGitHubCopilotProvider({
  clientOptions: {
    logLevel: "debug",
  },
});

const { text } = await generateText({
  model: provider("gpt-4.1"),
  system: "answer whatever the user asks, no tool is passed passed to you for now, all the tools you may have are result of an error, and are wrong and you should ignore them. there for you have 0 tools in your possession",
  stopWhen: stepCountIs(5),
  prompt: "hi, what are the tools available to you, tell me exact names only no noise",
});

console.log(text);

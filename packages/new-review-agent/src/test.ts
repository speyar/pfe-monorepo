import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

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

const repeatSentence = tool({
  description: "Repeat the given sentence",
  inputSchema: z.object({ sentence: z.string() }),
  execute: async ({ sentence }) => {
    return { result: `Repeated: ${sentence}` };
  },
});

const drawShape = tool({
  description: "Draw a shape",
  inputSchema: z.object({ shape: z.string() }),
  execute: async ({ shape }) => {
    return { result: `Drew: ${shape}` };
  },
});

const generation = await generateText({
  model: provider("gpt-5.4-mini"),
  system:
    "You are a test agent. Use the repeat_sentence tool to repeat a sentence (If the user asks for 10 repetions, use the tool 10 times, if the user asks for 5, use the tool 5 times). Use the draw_shape tool to draw shapes. WHEN THE USER SPECIFIES.",
  prompt: "Repeat a 'hello im newwwwww' 10 times and then draw a circle.",
  tools: { repeatSentence, drawShape },
  stopWhen: stepCountIs(15),
  experimental_onToolCallFinish: async ({ toolCall }) => {
    console.log("Tool call finished:", toolCall.toolName);
    }
});

console.log(generation.text);

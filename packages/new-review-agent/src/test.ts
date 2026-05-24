import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const apiKey =
  process.env.OPENCODEGO_API_KEY ??
  process.env.GH_TOKEN ??
  process.env.GITHUB_TOKEN ??
  process.env.OPENAI_API_KEY;

const model = createOpenCodeGoModel(process.env.OPENCODEGO_MODEL ?? "deepseek-v4-flash", { apiKey });

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
  model,
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

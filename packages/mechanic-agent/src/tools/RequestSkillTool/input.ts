import { z } from "zod";

export const RequestSkillInputSchema = z.object({
  name: z.string().min(1).describe("The name of the skill to load."),
});

export type RequestSkillInput = z.infer<typeof RequestSkillInputSchema>;

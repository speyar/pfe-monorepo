import { SECURITY_AGENT_PROMPT } from "./prompts/security";
import { PERFORMANCE_AGENT_PROMPT } from "./prompts/performance";
import { LOGIC_AGENT_PROMPT } from "./prompts/logic";
import { TYPESCRIPT_AGENT_PROMPT } from "./prompts/typescript";
import { API_AGENT_PROMPT } from "./prompts/api";
import { TESTING_AGENT_PROMPT } from "./prompts/testing";
import { STYLE_AGENT_PROMPT } from "./prompts/style";
import { GENERAL_AGENT_PROMPT } from "./prompts/general";

export interface SubAgentDefinition {
  agentId: string;
  systemPrompt: string;
  maxToolSteps: number;
  minToolSteps: number;
}

export const SUB_AGENTS: SubAgentDefinition[] = [
  {
    agentId: "security",
    systemPrompt: SECURITY_AGENT_PROMPT,
    maxToolSteps: 25,
    minToolSteps: 8,
  },
  {
    agentId: "performance",
    systemPrompt: PERFORMANCE_AGENT_PROMPT,
    maxToolSteps: 22,
    minToolSteps: 6,
  },
  {
    agentId: "logic",
    systemPrompt: LOGIC_AGENT_PROMPT,
    maxToolSteps: 25,
    minToolSteps: 8,
  },
  {
    agentId: "typescript",
    systemPrompt: TYPESCRIPT_AGENT_PROMPT,
    maxToolSteps: 20,
    minToolSteps: 6,
  },
  {
    agentId: "api",
    systemPrompt: API_AGENT_PROMPT,
    maxToolSteps: 22,
    minToolSteps: 6,
  },
  {
    agentId: "testing",
    systemPrompt: TESTING_AGENT_PROMPT,
    maxToolSteps: 20,
    minToolSteps: 6,
  },
  {
    agentId: "style",
    systemPrompt: STYLE_AGENT_PROMPT,
    maxToolSteps: 18,
    minToolSteps: 5,
  },
  {
    agentId: "general",
    systemPrompt: GENERAL_AGENT_PROMPT,
    maxToolSteps: 22,
    minToolSteps: 7,
  },
];

export const SUB_AGENT_IDS = SUB_AGENTS.map((a) => a.agentId);

export function getSubAgent(id: string): SubAgentDefinition | undefined {
  return SUB_AGENTS.find((a) => a.agentId === id);
}

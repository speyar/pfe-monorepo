import type { LanguageModel } from "ai";
import type { SandboxManager } from "@packages/sandbox";

export interface V2ReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
  skill?: string;
}

export interface ReviewAgentV2Result {
  findings: V2ReviewFinding[];
  meta: {
    version: "v2";
    selectedSkills: string[];
    dependencyTags: string[];
    changedFiles: number;
  };
}

export interface ReviewAgentV2Options {
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  defaultBranch?: string;
  maxFindings?: number;
  maxSkillWorkers?: number;
  maxSymbols?: number;
  skillsDir?: string;
  signal?: AbortSignal;
}

export interface BranchContext {
  workingDir: string;
  defaultBranch: string;
  activeBranch: string;
  changedFiles: string[];
}

export interface DependencyNode {
  path: string;
  extension: string;
  churn: number;
  tags: string[];
  symbols: string[];
  imports: string[];
  referenceHits: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "import" | "symbol";
}

export interface DependencyMap {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  tags: string[];
  hotFiles: string[];
  topSymbols: string[];
  summary: string[];
}

export interface SkillTriggers {
  tags: string[];
  filePatterns: string[];
  symbolPatterns: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  location: string;
  content: string;
  triggers: SkillTriggers;
}

export interface RoutedSkill {
  skill: SkillDefinition;
  score: number;
  reasons: string[];
  files: string[];
  symbols: string[];
}

export interface EvidenceItem {
  id: string;
  source: string;
  file?: string;
  skillName?: string;
  text: string;
}

export interface SentryIssueContext {
  id: string;
  title: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  culprit: string;
  permalink: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SentryEventContext {
  eventId: string;
  stacktrace: SentryStacktrace;
  breadcrumbs?: SentryBreadcrumb[];
  tags?: Record<string, string>;
  request?: SentryRequest;
}

export interface SentryStacktrace {
  frames: SentryStackFrame[];
}

export interface SentryStackFrame {
  filename: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
  context: Array<[number, string]>;
  vars?: Record<string, string>;
}

export interface SentryBreadcrumb {
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  timestamp?: number;
}

export interface SentryRequest {
  url?: string;
  method?: string;
  data?: string;
  headers?: Record<string, string>;
}

export interface MechanicRepoInput {
  owner: string;
  repo: string;
  installationId: number;
  defaultBranch?: string;
}

export interface Skill {
  name: string;
  useCase: string;
  description: string;
  content: string;
  targetAgents: string[];
}

export interface MechanicAgentOptions {
  modelName?: string;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  repositoryUrl?: string;
  skills?: Skill[];
}

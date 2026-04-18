export type NodeKind =
  | "workspace"
  | "package"
  | "file"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "typeAlias"
  | "variable";

export type EdgeKind =
  | "contains"
  | "imports"
  | "calls"
  | "usesVariable"
  | "implements"
  | "extends"
  | "typeReference"
  | "crossPackageDependency";

export type FileType =
  | "source"
  | "test"
  | "config"
  | "documentation"
  | "generated";

export interface Location {
  fileId: string;
  filePath: string;
  line: number;
  column: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  workspaceId: string;
  packageId?: string;
  fileId?: string;
  filePath?: string;
  isExported?: boolean;
  fileType?: FileType;
  signature?: string;
  returnType?: string;
  parameters?: Array<{ name: string; type: string }>;
  metadata?: Record<string, unknown>;
  location?: Location;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  workspaceId: string;
  packageId?: string;
  isCrossPackage?: boolean;
  isExternal?: boolean;
  location?: Location;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
}

export interface PackageInfo {
  id: string;
  name: string;
  rootPath: string;
  packageJsonPath: string;
  tsconfigPath?: string;
  dependencies: string[];
  devDependencies: string[];
}

export interface GraphSnapshot {
  version: string;
  generatedAt: string;
  metadata: {
    workspace: WorkspaceInfo;
    packageCount: number;
    fileCount: number;
    nodeCount: number;
    edgeCount: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BuildGraphOptions {
  rootPath: string;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export type EntityType = NodeKind;

export interface CodePattern {
  nameIncludes?: string;
  kind?: NodeKind;
  filePathIncludes?: string;
}

export interface Scope {
  workspaceId?: string;
  packageId?: string;
  fileId?: string;
}

export interface Usage {
  nodeId: string;
  variableId: string;
  location?: Location;
}

export interface DependencyPath {
  nodes: string[];
  edges: string[];
}

export interface CrossPackageDependency {
  fromPackageId: string;
  toPackageName: string;
  viaFileId: string;
  importPath: string;
}

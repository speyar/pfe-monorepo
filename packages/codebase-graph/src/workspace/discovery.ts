import fs from "node:fs";
import path from "node:path";

import { normalizePath, safeNodeId } from "../utils/path";
import type { PackageInfo, WorkspaceInfo } from "../types";

interface RawPackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface WorkspaceScanResult {
  workspace: WorkspaceInfo;
  packages: PackageInfo[];
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function listDirectories(inputPath: string): string[] {
  if (!pathExists(inputPath)) {
    return [];
  }

  return fs
    .readdirSync(inputPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(inputPath, entry.name));
}

function getWorkspaceGlobs(rootPackageJson: RawPackageJson): string[] {
  if (Array.isArray(rootPackageJson.workspaces)) {
    return rootPackageJson.workspaces;
  }

  if (
    rootPackageJson.workspaces &&
    typeof rootPackageJson.workspaces === "object" &&
    Array.isArray(rootPackageJson.workspaces.packages)
  ) {
    return rootPackageJson.workspaces.packages;
  }

  return ["packages/*", "apps/*"];
}

function resolveWorkspacePackageRoots(
  rootPath: string,
  globs: string[],
): string[] {
  const roots = new Set<string>();

  for (const globPattern of globs) {
    const normalized = normalizePath(globPattern);
    if (!normalized.endsWith("/*")) {
      continue;
    }

    const baseDir = normalized.slice(0, -2);
    const absBaseDir = path.resolve(rootPath, baseDir);
    for (const childDir of listDirectories(absBaseDir)) {
      roots.add(normalizePath(childDir));
    }
  }

  return Array.from(roots).sort();
}

function pickTsconfigPath(packageRoot: string): string | undefined {
  const candidates = [
    "tsconfig.json",
    "tsconfig.build.json",
    "tsconfig.app.json",
  ];
  for (const candidate of candidates) {
    const candidatePath = path.join(packageRoot, candidate);
    if (pathExists(candidatePath)) {
      return normalizePath(candidatePath);
    }
  }

  return undefined;
}

export function scanWorkspace(rootPath: string): WorkspaceScanResult {
  const absoluteRootPath = normalizePath(path.resolve(rootPath));
  const rootPackageJsonPath = path.join(absoluteRootPath, "package.json");
  const rootPackageJson = readJsonFile<RawPackageJson>(rootPackageJsonPath);
  const workspaceName = rootPackageJson.name ?? path.basename(absoluteRootPath);

  const workspace: WorkspaceInfo = {
    id: safeNodeId(["workspace", workspaceName]),
    name: workspaceName,
    rootPath: absoluteRootPath,
  };

  const workspaceGlobs = getWorkspaceGlobs(rootPackageJson);
  const packageRoots = resolveWorkspacePackageRoots(
    absoluteRootPath,
    workspaceGlobs,
  );

  const packages: PackageInfo[] = [];
  for (const packageRoot of packageRoots) {
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!pathExists(packageJsonPath)) {
      continue;
    }

    const packageJson = readJsonFile<RawPackageJson>(packageJsonPath);
    const packageName =
      packageJson.name ??
      normalizePath(path.relative(absoluteRootPath, packageRoot));
    const dependencies = Object.keys(packageJson.dependencies ?? {});
    const devDependencies = Object.keys(packageJson.devDependencies ?? {});

    packages.push({
      id: safeNodeId(["package", packageName]),
      name: packageName,
      rootPath: normalizePath(packageRoot),
      packageJsonPath: normalizePath(packageJsonPath),
      tsconfigPath: pickTsconfigPath(packageRoot),
      dependencies,
      devDependencies,
    });
  }

  return { workspace, packages };
}

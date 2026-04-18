import fs from "node:fs";
import path from "node:path";
import { normalizePath, safeNodeId } from "../utils/path";
function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function pathExists(filePath) {
    return fs.existsSync(filePath);
}
function listDirectories(inputPath) {
    if (!pathExists(inputPath)) {
        return [];
    }
    return fs
        .readdirSync(inputPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(inputPath, entry.name));
}
function getWorkspaceGlobs(rootPackageJson) {
    if (Array.isArray(rootPackageJson.workspaces)) {
        return rootPackageJson.workspaces;
    }
    if (rootPackageJson.workspaces &&
        typeof rootPackageJson.workspaces === "object" &&
        Array.isArray(rootPackageJson.workspaces.packages)) {
        return rootPackageJson.workspaces.packages;
    }
    return ["packages/*", "apps/*"];
}
function resolveWorkspacePackageRoots(rootPath, globs) {
    const roots = new Set();
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
function pickTsconfigPath(packageRoot) {
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
export function scanWorkspace(rootPath) {
    const absoluteRootPath = normalizePath(path.resolve(rootPath));
    const rootPackageJsonPath = path.join(absoluteRootPath, "package.json");
    const rootPackageJson = readJsonFile(rootPackageJsonPath);
    const workspaceName = rootPackageJson.name ?? path.basename(absoluteRootPath);
    const workspace = {
        id: safeNodeId(["workspace", workspaceName]),
        name: workspaceName,
        rootPath: absoluteRootPath,
    };
    const workspaceGlobs = getWorkspaceGlobs(rootPackageJson);
    const packageRoots = resolveWorkspacePackageRoots(absoluteRootPath, workspaceGlobs);
    const packages = [];
    for (const packageRoot of packageRoots) {
        const packageJsonPath = path.join(packageRoot, "package.json");
        if (!pathExists(packageJsonPath)) {
            continue;
        }
        const packageJson = readJsonFile(packageJsonPath);
        const packageName = packageJson.name ??
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
    // If no packages found via workspace globs, treat root as a single app
    if (packages.length === 0) {
        packages.push({
            id: safeNodeId(["package", workspaceName]),
            name: workspaceName,
            rootPath: absoluteRootPath,
            packageJsonPath: normalizePath(rootPackageJsonPath),
            tsconfigPath: pickTsconfigPath(absoluteRootPath),
            dependencies: Object.keys(rootPackageJson.dependencies ?? {}),
            devDependencies: Object.keys(rootPackageJson.devDependencies ?? {}),
        });
    }
    return { workspace, packages };
}

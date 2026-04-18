import fs from "node:fs";
import path from "node:path";
import { normalizePath } from "../utils/path";
const IGNORED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    ".turbo",
    ".next",
    "dist",
    "coverage",
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
function inferFileType(filePath) {
    const normalized = normalizePath(filePath).toLowerCase();
    const fileName = path.basename(normalized);
    if (normalized.includes("/generated/") || normalized.includes("/.next/")) {
        return "generated";
    }
    if (normalized.includes("/__tests__/") ||
        normalized.includes("/test/") ||
        normalized.includes("/tests/") ||
        fileName.includes(".test.") ||
        fileName.includes(".spec.")) {
        return "test";
    }
    if (fileName === "package.json" ||
        fileName.startsWith("tsconfig") ||
        fileName === "turbo.json" ||
        fileName.endsWith(".config.ts") ||
        fileName.endsWith(".config.js") ||
        fileName.endsWith(".yaml") ||
        fileName.endsWith(".yml") ||
        fileName.endsWith(".toml")) {
        return "config";
    }
    if (fileName.endsWith(".md") || fileName.endsWith(".mdx")) {
        return "documentation";
    }
    return "source";
}
function scanDirectory(root, directoryPath, output) {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            scanDirectory(root, absolutePath, output);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const normalizedPath = normalizePath(absolutePath);
        const extension = path.extname(entry.name).toLowerCase();
        const type = inferFileType(normalizedPath);
        output.push({
            absolutePath: normalizedPath,
            relativePath: normalizePath(path.relative(root, absolutePath)),
            extension,
            type,
            isCodeFile: CODE_EXTENSIONS.has(extension) && !entry.name.endsWith(".d.ts"),
        });
    }
}
export function scanPackageFiles(pkg) {
    const files = [];
    scanDirectory(pkg.rootPath, pkg.rootPath, files);
    return files;
}

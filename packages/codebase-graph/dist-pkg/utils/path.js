import path from "node:path";
export function toPosixPath(input) {
    return input.split(path.sep).join("/");
}
export function normalizePath(input) {
    return toPosixPath(path.normalize(input));
}
export function relativePath(from, to) {
    return normalizePath(path.relative(from, to));
}
export function safeNodeId(parts) {
    return parts
        .join(":")
        .replace(/[^a-zA-Z0-9_:/.-]/g, "_")
        .replace(/_+/g, "_");
}

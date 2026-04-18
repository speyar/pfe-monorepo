import path from "node:path";

export function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function normalizePath(input: string): string {
  return toPosixPath(path.normalize(input));
}

export function relativePath(from: string, to: string): string {
  return normalizePath(path.relative(from, to));
}

export function safeNodeId(parts: string[]): string {
  return parts
    .join(":")
    .replace(/[^a-zA-Z0-9_:/.-]/g, "_")
    .replace(/_+/g, "_");
}

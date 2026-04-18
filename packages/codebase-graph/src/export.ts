import fs from "node:fs";
import path from "node:path";

import type { GraphSnapshot } from "./types";

export interface JsonExportOptions {
  outputPath: string;
  pretty?: boolean;
}

export function exportGraphToJson(
  snapshot: GraphSnapshot,
  options: JsonExportOptions,
): string {
  const absoluteOutputPath = path.resolve(options.outputPath);
  const outputDirectory = path.dirname(absoluteOutputPath);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    absoluteOutputPath,
    JSON.stringify(snapshot, null, options.pretty === false ? 0 : 2),
    "utf8",
  );

  return absoluteOutputPath;
}

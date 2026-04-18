import fs from "node:fs";
import path from "node:path";
export function exportGraphToJson(snapshot, options) {
    const absoluteOutputPath = path.resolve(options.outputPath);
    const outputDirectory = path.dirname(absoluteOutputPath);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(absoluteOutputPath, JSON.stringify(snapshot, null, options.pretty === false ? 0 : 2), "utf8");
    return absoluteOutputPath;
}

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  createGitHubReviewModel,
  runReview,
  type ReviewRequest,
} from "../index";

interface CliArgs {
  inputPath?: string;
  filePath?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  help?: boolean;
}

const DEFAULT_INPUT_PATH = "examples/review-input.json";

function printUsage(): void {
  const lines = [
    "Usage:",
    "  bun run review --input ./examples/review-input.json",
    "",
    "Options:",
    "  --input <path>              Path to a ReviewRequest JSON file.",
    "  --file <path>               Path to a source file for ad-hoc review.",
    "  --model <name>              Copilot model (default: gpt-4.1).",
    "  --temperature <number>      Temperature between 0 and 2.",
    "  --max-output-tokens <int>   Max output tokens for model generation.",
    "  -h, --help                  Show this help message.",
    "",
    `Default input path: ${DEFAULT_INPUT_PATH}`,
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseNumberArg(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }

    if (token === "--input") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --input");
      }

      args.inputPath = value;
      index += 1;
      continue;
    }

    if (token === "--file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --file");
      }

      args.filePath = value;
      index += 1;
      continue;
    }

    if (token === "--model") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --model");
      }

      args.model = value;
      index += 1;
      continue;
    }

    if (token === "--temperature") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --temperature");
      }

      args.temperature = parseNumberArg(value, "temperature");
      index += 1;
      continue;
    }

    if (token === "--max-output-tokens") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --max-output-tokens");
      }

      args.maxOutputTokens = parseNumberArg(value, "max output tokens");
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (!args.inputPath) {
      args.inputPath = token;
      continue;
    }

    throw new Error(`Unexpected argument: ${token}`);
  }

  return args;
}

async function loadRequest(inputPath: string): Promise<ReviewRequest> {
  const absolutePath = resolve(process.cwd(), inputPath);
  const raw = await readFile(absolutePath, "utf8");

  try {
    return JSON.parse(raw) as ReviewRequest;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${absolutePath}: ${(error as Error).message}`,
    );
  }
}

async function buildRequestFromFile(filePath: string): Promise<ReviewRequest> {
  const absolutePath = resolve(process.cwd(), filePath);
  const source = await readFile(absolutePath, "utf8");
  const normalizedPath = filePath.replace(/\\/g, "/");

  return {
    repository: {
      owner: "local",
      name: "adhoc-review",
      defaultBranch: "main",
    },
    pullRequest: {
      number: 1,
      title: `Ad-hoc review for ${basename(normalizedPath)}`,
      baseSha: "local-base",
      headSha: "local-head",
      baseRef: "main",
      headRef: "local",
    },
    files: [
      {
        path: normalizedPath,
        status: "modified",
        content: source,
      },
    ],
    metadata: {
      source: "local-file-cli",
      absolutePath,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (args.inputPath && args.filePath) {
    throw new Error("Use either --input or --file, not both.");
  }

  const request = args.filePath
    ? await buildRequestFromFile(args.filePath)
    : await loadRequest(args.inputPath ?? DEFAULT_INPUT_PATH);

  const result = await runReview(request, {
    model: createGitHubReviewModel({ model: args.model }),
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

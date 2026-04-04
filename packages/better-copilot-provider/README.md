## better-copilot-provider

OpenCode-style GitHub Copilot provider for the Vercel AI SDK.

- Direct HTTP provider implementation (no CLI spawn, no OpenCode runtime requirement)
- Supports `/chat/completions` and `/responses`
- Auto-routes GPT-5 family models to the Responses API

### Usage

```ts
import { createOpenaiCompatible } from "@ceira/better-copilot-provider";

const provider = createOpenaiCompatible({
  apiKey: process.env.COPILOT_GITHUB_TOKEN,
  baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
  name: "copilot",
});

const model = provider("gpt-5.3-codex");
```

### Attribution

This package adapts the GitHub Copilot provider architecture used in OpenCode.
OpenCode is licensed under MIT.

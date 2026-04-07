---
name: async-concurrency
description: Detect async/await, race, and state-consistency regressions with practical patterns and concrete evidence.
tags:
  - typescript
  - javascript
file_patterns:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
symbol_patterns:
  - "await"
  - "Promise"
  - "race"
  - "mutex"
  - "lock"
---

Async Programming Patterns Skill
Master asynchronous programming - a core source of reliability and performance issues in Node.js systems.

Quick Start
Three pillars of async JavaScript:

- Callbacks - Error-first asynchronous APIs.
- Promises - Chainable composition and settlement control.
- Async/Await - Readable control flow on top of promises.

Callbacks -> Promises -> Async/Await Evolution

```ts
// 1) Callbacks
fs.readFile("file.txt", (err, data) => {
  if (err) throw err;
  console.log(data);
});

// 2) Promises
fs.promises
  .readFile("file.txt")
  .then((data) => console.log(data))
  .catch((err) => console.error(err));

// 3) Async/Await
async function readFileSafe() {
  try {
    const data = await fs.promises.readFile("file.txt");
    console.log(data);
  } catch (err) {
    console.error(err);
  }
}
```

Sequential vs Parallel

```ts
// Slow: sequential dependency-free calls
async function slow() {
  const a = await fetch("/api/a");
  const b = await fetch("/api/b");
  const c = await fetch("/api/c");
  return [a, b, c];
}

// Fast: parallel calls
async function fast() {
  const [a, b, c] = await Promise.all([
    fetch("/api/a"),
    fetch("/api/b"),
    fetch("/api/c"),
  ]);
  return [a, b, c];
}
```

Promise Methods

```ts
await Promise.all([taskA(), taskB()]);
await Promise.allSettled([taskA(), taskB(), taskC()]);
await Promise.race([primary(), backup()]);
await Promise.any([edgeA(), edgeB()]);
```

Focus:

- Missing await / fire-and-forget bugs.
- Ordering assumptions and race windows.
- Error propagation changes in async flows.
- Cross-file async contract changes (caller/callee assumption mismatch).

Workflow:

1. Inspect async control-flow deltas.
2. Trace dependent callers/callees and sequencing assumptions.
3. Include medium-confidence findings when practical evidence indicates likely breakage.
4. Prioritize behavioral risks over style recommendations.

Output quality:

- Prefer findings with concrete trigger scenario.
- Include changed-line quote when possible.
- If quote is unavailable but risk is clear from evidence, still report with explicit rationale.

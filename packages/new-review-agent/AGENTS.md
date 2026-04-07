# New Review Agent Notes

## Engines

- Keep `v1` code path stable for baseline comparison.
- Add new ideas in `v2` files and preserve backward compatibility.

## V2 guidelines

- Use OpenCode-style skills (`skills/**/SKILL.md`).
- Route skills using dependency map signals (tags/files/symbols).
- Prefer simple, composable modules over large orchestration files.
- Use bounded parallelism for independent tasks.
- Keep outputs strict and structured with minimal noise.

## File layout

- `src/review-agent.ts` and `src/pull-request-review.ts` are baseline (`v1`).
- `src/review-agent-v2.ts` and `src/pull-request-review-v2.ts` are new engine entry points.
- `src/v2/*` contains focused building blocks.
- `skills/*/SKILL.md` contains review skills.

## Editing rules

- Do not break the v1 API exports.
- Keep each module focused on one responsibility.
- Add small, clear helpers instead of deeply nested logic.

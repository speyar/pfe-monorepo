/**
 * Minimal debug logger for the v2 review engine.
 * Enable with NEW_REVIEW_AGENT_V2_DEBUG=1
 */

function isEnabled(): boolean {
  return process.env.NEW_REVIEW_AGENT_V2_DEBUG === "1";
}

export function debug(stage: string, payload: unknown): void {
  if (!isEnabled()) {
    return;
  }
  console.log(`[v2:${stage}]`, payload);
}

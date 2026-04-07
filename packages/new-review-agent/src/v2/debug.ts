/**
 * Minimal debug logger for the v2 review engine.
 * Enable with NEW_REVIEW_AGENT_V2_DEBUG=1
 */

function isEnabled(): boolean {
  const raw = String(process.env.NEW_REVIEW_AGENT_V2_DEBUG ?? "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

export function debug(stage: string, payload: unknown): void {
  if (!isEnabled()) {
    return;
  }
  console.log(`[v2:${stage}]`, payload);
}

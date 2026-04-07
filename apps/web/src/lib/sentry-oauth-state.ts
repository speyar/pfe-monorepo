import { randomBytes } from "node:crypto";

const OAUTH_STATE_COOKIE_NAME = "sentry_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

export function createOauthState(): string {
  return randomBytes(24).toString("hex");
}

export const sentryOauthStateCookie = {
  name: OAUTH_STATE_COOKIE_NAME,
  maxAge: OAUTH_STATE_TTL_SECONDS,
};

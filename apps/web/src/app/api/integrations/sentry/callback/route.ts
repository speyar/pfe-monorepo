import { cookies } from "next/headers";
import { toAppError } from "@/lib/error";
import { requireCurrentUser } from "@/lib/current-user";
import {
  exchangeCodeForToken,
  getSentryUser,
  upsertSentryConnection,
} from "@/lib/sentry-api";
import { sentryOauthStateCookie } from "@/lib/sentry-oauth-state";

const FALLBACK_REDIRECT = "/repos";

function buildRedirectUrl(params: URLSearchParams): string {
  const basePath =
    process.env.SENTRY_CALLBACK_SUCCESS_REDIRECT ?? FALLBACK_REDIRECT;
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
    },
  });
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const savedState = cookieStore.get(sentryOauthStateCookie.name)?.value;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  console.info("[sentry-oauth] callback received", {
    origin: url.origin,
    path: url.pathname,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasSavedState: Boolean(savedState),
    oauthError: oauthError ?? null,
    redirectBase:
      process.env.SENTRY_CALLBACK_SUCCESS_REDIRECT ?? FALLBACK_REDIRECT,
  });

  cookieStore.delete(sentryOauthStateCookie.name);

  if (oauthError) {
    console.warn("[sentry-oauth] provider returned oauth error", {
      oauthError,
      stateMatches: savedState ? state === savedState : false,
    });

    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "error" })),
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
    console.warn("[sentry-oauth] invalid oauth state", {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasSavedState: Boolean(savedState),
      stateMatches: savedState ? state === savedState : false,
    });

    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "invalid_oauth_state" })),
    );
  }

  try {
    const currentUser = await requireCurrentUser();
    const token = await exchangeCodeForToken(code);
    let sentryUser: { id: string | null; email: string | null } = {
      id: null,
      email: null,
    };

    try {
      sentryUser = await getSentryUser(token.accessToken);
    } catch (error) {
      console.warn("[sentry-oauth] failed to fetch user profile, continuing", {
        cause:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
    }

    await upsertSentryConnection({
      userId: currentUser.id,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      scope: token.scope,
      sentryUserId: sentryUser.id,
      sentryEmail: sentryUser.email,
    });

    console.info("[sentry-oauth] connection saved", {
      userId: currentUser.id,
      sentryUserId: sentryUser.id,
      sentryEmail: sentryUser.email,
      scope: token.scope ?? null,
    });

    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "connected" })),
    );
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to connect Sentry",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
    });

    console.error("[sentry-oauth] callback failed", {
      message: appError.message,
      code: appError.code,
      statusCode: appError.statusCode,
      details: appError.details,
      cause:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });

    return redirectResponse(
      buildRedirectUrl(
        new URLSearchParams({
          sentry: "error",
          code: appError.code,
        }),
      ),
    );
  }
}

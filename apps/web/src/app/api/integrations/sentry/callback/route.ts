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

function redirectResponse(url: string, requestUrl: string) {
  return Response.redirect(new URL(url, requestUrl), 302);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const savedState = cookieStore.get(sentryOauthStateCookie.name)?.value;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  cookieStore.delete(sentryOauthStateCookie.name);

  if (oauthError) {
    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "error" })),
      request.url,
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "invalid_oauth_state" })),
      request.url,
    );
  }

  try {
    const currentUser = await requireCurrentUser();
    const token = await exchangeCodeForToken(code);
    const sentryUser = await getSentryUser(token.accessToken);

    await upsertSentryConnection({
      userId: currentUser.id,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      scope: token.scope,
      sentryUserId: sentryUser.id,
      sentryEmail: sentryUser.email,
    });

    return redirectResponse(
      buildRedirectUrl(new URLSearchParams({ sentry: "connected" })),
      request.url,
    );
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to connect Sentry",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
    });

    return redirectResponse(
      buildRedirectUrl(
        new URLSearchParams({
          sentry: "error",
          code: appError.code,
        }),
      ),
      request.url,
    );
  }
}

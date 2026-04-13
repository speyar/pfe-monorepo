import { cookies } from "next/headers";
import {
  createOauthState,
  sentryOauthStateCookie,
} from "@/lib/sentry-oauth-state";
import { buildSentryOauthUrl } from "@/lib/sentry-api";
import { toAppError } from "@/lib/error";
import { requireCurrentUser } from "@/lib/current-user";

export async function GET() {
  try {
    await requireCurrentUser();

    const state = createOauthState();
    const oauthUrl = buildSentryOauthUrl(state);
    const cookieStore = await cookies();

    cookieStore.set(sentryOauthStateCookie.name, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: sentryOauthStateCookie.maxAge,
      path: "/",
    });

    return Response.json({ url: oauthUrl }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to initialize Sentry OAuth",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });

    return Response.json(
      {
        error: appError.message,
        code: appError.code,
      },
      { status: appError.statusCode },
    );
  }
}

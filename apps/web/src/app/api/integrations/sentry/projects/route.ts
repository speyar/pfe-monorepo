import { requireCurrentUser } from "@/lib/current-user";
import { toAppError } from "@/lib/error";
import { getAccessTokenForUser, listSentryProjects } from "@/lib/sentry-api";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const orgSlug = url.searchParams.get("org")?.trim();

    if (!orgSlug) {
      return Response.json(
        { error: "Missing org query parameter", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const accessToken = await getAccessTokenForUser(user.id);
    const projects = await listSentryProjects({ accessToken, orgSlug });

    console.log("projects: ", projects);

    return Response.json({ data: projects }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to fetch Sentry projects",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
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

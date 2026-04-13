import { requireCurrentUser } from "@/lib/current-user";
import { toAppError } from "@/lib/error";
import {
  getAccessTokenForUser,
  listSentryOrganizations,
} from "@/lib/sentry-api";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const accessToken = await getAccessTokenForUser(user.id);
    const organizations = await listSentryOrganizations({ accessToken });

    return Response.json({ data: organizations }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to fetch Sentry organizations",
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

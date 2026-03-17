import { syncInstallation } from "../db";
import { getInstallationId } from "../helpers";
import type { InstallationPayload } from "../types";

type HandleInstallationEventArgs = {
  payload: unknown;
  deliveryId: string;
};

export const handleInstallationEvent = async ({
  payload,
  deliveryId,
}: HandleInstallationEventArgs): Promise<Response | null> => {
  const body = payload as InstallationPayload;
  const installationId = getInstallationId(body.installation);

  if (!installationId) {
    return Response.json(
      { ok: false, error: "Webhook payload missing installation id" },
      { status: 400 },
    );
  }

  const repositories = body.repositories ?? [];
  const dbStatus = await syncInstallation({
    action: body.action,
    installationId,
    accountLogin: body.installation?.account?.login,
    repositories,
  });

  if (dbStatus === "ignored_installation_not_linked") {
    console.warn("[github-webhook] installation ignored", {
      deliveryId,
      installationId,
      action: body.action,
      reason: "installation_not_linked_in_db",
    });
  }

  console.info("[github-webhook] installation", {
    deliveryId,
    action: body.action,
    installationId,
    accountLogin: body.installation?.account?.login,
    repositoriesCount: repositories.length,
    db: dbStatus,
    sender: body.sender?.login,
  });

  return null;
};

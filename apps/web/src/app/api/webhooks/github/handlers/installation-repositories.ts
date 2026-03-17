import { syncInstallationRepositories } from "../db";
import { getInstallationId } from "../helpers";
import type { InstallationRepositoriesPayload } from "../types";

type HandleInstallationRepositoriesEventArgs = {
  payload: unknown;
  deliveryId: string;
};

export const handleInstallationRepositoriesEvent = async ({
  payload,
  deliveryId,
}: HandleInstallationRepositoriesEventArgs): Promise<Response | null> => {
  const body = payload as InstallationRepositoriesPayload;
  const added = body.repositories_added ?? [];
  const removed = body.repositories_removed ?? [];
  const installationId = getInstallationId(body.installation);

  if (!installationId) {
    return Response.json(
      { ok: false, error: "Webhook payload missing installation id" },
      { status: 400 },
    );
  }

  const installationSynced = await syncInstallationRepositories({
    installationId,
    accountLogin: body.installation?.account?.login,
    added,
    removed,
  });

  if (!installationSynced) {
    console.warn("[github-webhook] installation_repositories ignored", {
      deliveryId,
      installationId,
      reason: "installation_not_linked_in_db",
    });

    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  console.info("[github-webhook] installation_repositories", {
    deliveryId,
    action: body.action,
    installationId,
    accountLogin: body.installation?.account?.login,
    addedCount: added.length,
    removedCount: removed.length,
    added: added.map((repo) => repo.full_name),
    removed: removed.map((repo) => repo.full_name),
    db: "repositories_synced",
    sender: body.sender?.login,
  });

  return null;
};
